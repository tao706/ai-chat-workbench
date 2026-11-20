import { buildRequestTrends } from "./request-trends.js";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { config } from "./config.js";
import {
  cleanLocalCalls,
  createLocalSession,
  deleteLocalSession,
  getLocalSession,
  listLocalCalls,
  listLocalSessions,
  renameLocalSession,
  saveLocalCall,
  saveLocalExchange,
  type CallRecord,
  type Session,
  type StoredMessage,
} from "./local-store.js";

let pool: Pool | undefined;
const enabled = () => Boolean(config.mysql.host && config.mysql.user);
function getPool(): Pool | undefined {
  if (!enabled()) return undefined;
  if (!pool)
    pool = mysql.createPool({
      ...config.mysql,
      waitForConnections: true,
      connectionLimit: 10,
      charset: "utf8mb4",
    });
  return pool;
}

export async function checkDatabase(): Promise<
  "connected" | "local" | "error"
> {
  const db = getPool();
  if (!db) return "local";
  try {
    await db.query("SELECT 1");
    return "connected";
  } catch {
    return "error";
  }
}

export async function listSessions(): Promise<Session[]> {
  const db = getPool();
  if (!db) return listLocalSessions();
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT session_id, title, model_name, created_at, updated_at FROM conversations WHERE status='active' ORDER BY updated_at DESC",
  );
  return rows.map((r) => ({
    sessionId: String(r.session_id),
    title: String(r.title),
    model: String(r.model_name),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    messages: [],
  }));
}

export async function getSession(id: string): Promise<Session | undefined> {
  const db = getPool();
  if (!db) return getLocalSession(id);
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, session_id, title, model_name, created_at, updated_at FROM conversations WHERE session_id=? AND status='active' LIMIT 1",
    [id],
  );
  if (!rows.length) return undefined;
  const r = rows[0];
  const [messages] = await db.execute<RowDataPacket[]>(
    "SELECT id, role, content, created_at FROM messages WHERE conversation_id=? ORDER BY id ASC",
    [r.id],
  );
  return {
    sessionId: id,
    title: String(r.title),
    model: String(r.model_name),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    messages: messages.map((m) => ({
      id: String(m.id),
      role: m.role as StoredMessage["role"],
      content: String(m.content),
      createdAt: new Date(m.created_at).toISOString(),
    })),
  };
}

export async function createSession(id: string): Promise<Session> {
  const db = getPool();
  if (!db) return createLocalSession(id);
  await db.execute(
    "INSERT IGNORE INTO conversations(session_id,model_name) VALUES(?,?)",
    [id, "演示模型"],
  );
  return (await getSession(id))!;
}

export async function renameSession(
  id: string,
  title: string,
): Promise<boolean> {
  const db = getPool();
  if (!db) return renameLocalSession(id, title);
  const [result] = await db.execute<mysql.ResultSetHeader>(
    "UPDATE conversations SET title=? WHERE session_id=? AND status='active'",
    [title, id],
  );
  return result.affectedRows > 0;
}

export async function deleteSession(id: string): Promise<boolean> {
  const db = getPool();
  if (!db) return deleteLocalSession(id);
  const [result] = await db.execute<mysql.ResultSetHeader>(
    "DELETE FROM conversations WHERE session_id=?",
    [id],
  );
  return result.affectedRows > 0;
}

export async function saveExchange(
  id: string,
  user: string,
  assistant: string,
  model: string,
): Promise<void> {
  const db = getPool();
  if (!db) return saveLocalExchange(id, user, assistant, model);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      "INSERT INTO conversations(session_id,model_name,title) VALUES(?,?,?) ON DUPLICATE KEY UPDATE model_name=VALUES(model_name),updated_at=CURRENT_TIMESTAMP,title=IF(title='新会话',VALUES(title),title)",
      [id, model, user.slice(0, 28)],
    );
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM conversations WHERE session_id=?",
      [id],
    );
    const conversationId = rows[0].id;
    await connection.execute(
      "INSERT INTO messages(conversation_id,role,content) VALUES(?,'user',?),(?,'assistant',?)",
      [conversationId, user, conversationId, assistant],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function saveCall(call: CallRecord): Promise<void> {
  const db = getPool();
  if (!db) return saveLocalCall(call);
  await createSession(call.sessionId);
  await db.execute(
    "INSERT INTO model_calls(conversation_id,trace_id,model_name,completion_tokens,duration_ms,first_token_latency_ms,output_chars,status,error_message) SELECT id,?,?,?,?,?,?,?,? FROM conversations WHERE session_id=?",
    [
      call.traceId,
      call.model,
      0,
      call.durationMs,
      call.firstTokenMs,
      call.outputChars,
      call.status,
      call.error || null,
      call.sessionId,
    ],
  );
}

export async function listCalls(limit = 200): Promise<CallRecord[]> {
  const db = getPool();
  if (!db) return (await listLocalCalls()).slice(0, limit);
  const safeLimit = Math.min(5000, Math.max(1, Math.floor(limit)));
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT c.session_id,m.trace_id,m.model_name,m.status,m.duration_ms,m.first_token_latency_ms,m.output_chars,m.error_message,m.created_at FROM model_calls m JOIN conversations c ON c.id=m.conversation_id ORDER BY m.id DESC LIMIT ${safeLimit}`,
  );
  return rows.map((r) => ({
    sessionId: String(r.session_id),
    traceId: String(r.trace_id),
    model: String(r.model_name),
    status: r.status as CallRecord["status"],
    durationMs: Number(r.duration_ms || 0),
    firstTokenMs:
      r.first_token_latency_ms == null
        ? null
        : Number(r.first_token_latency_ms),
    outputChars: Number(r.output_chars || 0),
    error: r.error_message ? String(r.error_message) : undefined,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function dashboardMetrics(activeStreams: number) {
  const now = Date.now();
  const db = getPool();
  let calls: CallRecord[];
  if (db) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT m.status,m.duration_ms,m.first_token_latency_ms,m.output_chars,m.created_at FROM model_calls m JOIN conversations c ON c.id=m.conversation_id WHERE m.created_at > ? AND m.created_at <= ?",
      [new Date(now - 7 * 24 * 3600_000), new Date(now)],
    );
    calls = rows.map(
      (r) =>
        ({
          status: r.status,
          durationMs: Number(r.duration_ms || 0),
          firstTokenMs:
            r.first_token_latency_ms == null
              ? null
              : Number(r.first_token_latency_ms),
          outputChars: Number(r.output_chars || 0),
          createdAt: new Date(r.created_at).toISOString(),
        }) as CallRecord,
    );
  } else calls = await listLocalCalls();
  const recent = calls.filter((c) => {
    const t = new Date(c.createdAt).getTime();
    return t > now - 24 * 3600_000 && t <= now;
  });
  const completed = recent.filter((c) => c.status === "completed");
  const first = completed.filter((c) => c.firstTokenMs !== null);
  const avg = (values: number[]) =>
    values.length
      ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
      : null;
  const trends = buildRequestTrends(calls, now);
  const buckets = trends["24h"];
  return {
    activeStreams,
    sessions: (await listSessions()).length,
    requests24h: recent.length,
    successRate: recent.length
      ? Math.round((completed.length / recent.length) * 1000) / 10
      : null,
    avgFirstTokenMs: avg(first.map((c) => c.firstTokenMs!)),
    avgCharsPerSecond: avg(
      completed
        .filter((c) => c.durationMs > 0)
        .map((c) => (c.outputChars * 1000) / c.durationMs),
    ),
    buckets,
    trends,
  };
}

export async function cleanCalls(before: number): Promise<number> {
  const db = getPool();
  if (!db) return cleanLocalCalls(before);
  const [result] = await db.execute<mysql.ResultSetHeader>(
    "DELETE FROM model_calls WHERE created_at <= ?",
    [new Date(before)],
  );
  return result.affectedRows;
}
