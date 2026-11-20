import { describeModelError } from "./model-errors.js";
import {
  CALL_CLEANUP_INTERVAL,
  cleanupCutoff,
  runCallRetention,
} from "./call-retention.js";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { config } from "./config.js";
import {
  cleanCalls,
  checkDatabase,
  createSession,
  dashboardMetrics,
  deleteSession,
  getSession,
  listCalls,
  listSessions,
  renameSession,
  saveCall,
  saveExchange,
} from "./database.js";
import { generateTokens, modelMode } from "./chat-service.js";
import {
  addDocument,
  deleteDocument,
  listDocuments,
  searchKnowledge,
} from "./knowledge.js";
import type { CallRecord } from "./local-store.js";

const app = express();
let activeStreams = 0;
app.use(cors({ origin: config.frontendOrigin }));
app.use(express.json({ limit: "1mb" }));
const asyncRoute =
  (handler: express.RequestHandler): express.RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
const sessionId = z.string().regex(/^session_[a-zA-Z0-9-]{8,64}$/);
const chatSchema = z.object({
  message: z.string().trim().min(1).max(10_000),
  sessionId,
  useKnowledge: z.boolean().default(false),
});

app.get(
  "/api/health",
  asyncRoute(async (_req, res) => {
    const database = await checkDatabase();
    res.json({
      status: database === "error" ? "degraded" : "ok",
      database,
      model: modelMode(),
      activeStreams,
      uptime: Math.floor(process.uptime()),
    });
  }),
);
app.get(
  "/api/metrics",
  asyncRoute(async (_req, res) =>
    res.json(await dashboardMetrics(activeStreams)),
  ),
);
app.get(
  "/api/calls",
  asyncRoute(async (_req, res) => res.json(await listCalls(100))),
);
app.post(
  "/api/calls/cleanup",
  asyncRoute(async (req, res) => {
    const { scope } = z
      .object({ scope: z.enum(["older7", "older30", "all"]) })
      .strict()
      .parse(req.body);
    const deleted = await cleanCalls(cleanupCutoff(scope));
    res.json({ deleted });
  }),
);
app.get(
  "/api/sessions",
  asyncRoute(async (_req, res) => res.json(await listSessions())),
);
app.post(
  "/api/sessions",
  asyncRoute(async (req, res) => {
    const id = sessionId.parse(req.body?.sessionId);
    res.status(201).json(await createSession(id));
  }),
);
app.get(
  "/api/sessions/:id",
  asyncRoute(async (req, res) => {
    const id = sessionId.parse(req.params.id);
    const session = await getSession(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }
    res.json(session);
  }),
);
app.patch(
  "/api/sessions/:id",
  asyncRoute(async (req, res) => {
    const id = sessionId.parse(req.params.id);
    const { title } = z
      .object({ title: z.string().trim().min(1).max(80) })
      .parse(req.body);
    if (!(await renameSession(id, title))) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }
    res.json({ ok: true });
  }),
);
app.delete(
  "/api/sessions/:id",
  asyncRoute(async (req, res) => {
    const id = sessionId.parse(req.params.id);
    if (!(await deleteSession(id))) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }
    res.json({ ok: true });
  }),
);
app.get(
  "/api/knowledge",
  asyncRoute(async (_req, res) => res.json(await listDocuments())),
);
app.post(
  "/api/knowledge",
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        title: z.string().trim().min(1).max(120),
        text: z.string().trim().min(20).max(100_000),
      })
      .parse(req.body);
    res.status(201).json(await addDocument(input.title, input.text));
  }),
);
app.delete(
  "/api/knowledge/:id",
  asyncRoute(async (req, res) => {
    if (!(await deleteDocument(String(req.params.id)))) {
      res.status(404).json({ error: "资料不存在" });
      return;
    }
    res.json({ ok: true });
  }),
);

app.post(
  "/api/chat",
  asyncRoute(async (req, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "消息或会话参数不合法" });
      return;
    }
    const { message, sessionId: id, useKnowledge } = parsed.data;
    const previous = await getSession(id);
    const history = previous?.messages || [];
    const retrieval = useKnowledge
      ? await searchKnowledge(message)
      : { mode: "keyword" as const, passages: [] };
    const startedAt = Date.now();
    const traceId = `trace_${crypto.randomUUID().slice(0, 12)}`;
    const model = modelMode() === "connected" ? config.chatModel : "演示模型";
    const controller = new AbortController();
    let closed = false,
      ended = false,
      answer = "",
      firstTokenMs: number | null = null;
    req.on("aborted", () => {
      closed = true;
      controller.abort();
    });
    res.on("close", () => {
      if (!ended) {
        closed = true;
        controller.abort();
      }
    });
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    activeStreams += 1;
    const send = (event: string, data: object) => {
      if (!closed)
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send("meta", { traceId, model, startedAt, mode: modelMode() });
    if (useKnowledge)
      send("sources", {
        mode: retrieval.mode,
        passages: retrieval.passages.map(
          ({ documentId, title, chunk, text, score }) => ({
            documentId,
            title,
            chunk,
            text: text.slice(0, 240),
            score,
          }),
        ),
      });
    let status: CallRecord["status"] = "completed",
      failure: string | undefined,
      callSaved = false;
    const persistCall = () =>
      saveCall({
        traceId,
        sessionId: id,
        model,
        status,
        durationMs: Date.now() - startedAt,
        firstTokenMs,
        outputChars: answer.length,
        error: failure,
        createdAt: new Date().toISOString(),
      });
    try {
      for await (const token of generateTokens(
        message,
        history,
        retrieval.passages,
        controller.signal,
      )) {
        if (closed) break;
        if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt;
        answer += token;
        send("token", { token });
      }
      if (closed) status = "cancelled";
      else {
        await saveExchange(id, message, answer, model);
        await persistCall();
        callSaved = true;
        send("done", {
          traceId,
          durationMs: Date.now() - startedAt,
          firstTokenMs,
          outputChars: answer.length,
        });
        ended = true;
        res.end();
      }
    } catch (cause) {
      status = closed || controller.signal.aborted ? "cancelled" : "failed";
      failure = cause instanceof Error ? cause.message : "未知错误";
      if (!closed) {
        send("error", { ...describeModelError(cause), traceId });
        ended = true;
        res.end();
      }
    } finally {
      activeStreams = Math.max(0, activeStreams - 1);
      if (!callSaved) {
        try {
          await persistCall();
        } catch (cause) {
          console.error("调用记录保存失败", cause);
        }
      }
    }
  }),
);

app.use(
  (
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const status = error instanceof z.ZodError ? 400 : 500;
    if (!res.headersSent)
      res
        .status(status)
        .json({ error: status === 400 ? "输入数据不合法" : error.message });
  },
);
await runCallRetention();
const retentionTimer = setInterval(
  () => void runCallRetention(),
  CALL_CLEANUP_INTERVAL,
);
retentionTimer.unref();
app.listen(config.port, "127.0.0.1", () =>
  console.log(`API http://127.0.0.1:${config.port}`),
);
