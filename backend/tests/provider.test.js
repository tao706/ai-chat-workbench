import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}` };
}
async function freePort() {
  const { server, url } = await listen((_req, res) => res.end());
  await new Promise((resolve) => server.close(resolve));
  return Number(new URL(url).port);
}
async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
}
function sendChunk(res, content, finish = false) {
  res.write(
    `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content }, finish_reason: finish ? "stop" : null }] })}\n\n`,
  );
  if (finish) res.end("data: [DONE]\n\n");
}
async function withApp(handler, run, extraEnv = {}) {
  const mock = await listen(handler);
  const temp = await mkdtemp(path.join(os.tmpdir(), "ai-stream-provider-"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      APP_DATA_DIR: temp,
      MYSQL_HOST: "",
      MYSQL_USER: "",
      CHAT_API_KEY: "mock-chat-key",
      CHAT_BASE_URL: mock.url,
      CHAT_MODEL: "mock-model",
      EMBEDDING_API_KEY: "",
      ...extraEnv,
    },
    stdio: "ignore",
  });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        ready = (await fetch(`${base}/api/health`)).ok;
        if (ready) break;
      } catch {}
      await delay(100);
    }
    assert.ok(ready, "test API did not start");
    await run(base, mock.url, temp);
  } finally {
    child.kill();
    await new Promise((resolve) => mock.server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
}
function chat(base, message, sessionId, useKnowledge = false) {
  return fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, sessionId, useKnowledge }),
  });
}

test("model authentication error is reported and recorded without a fake answer", async () => {
  await withApp(
    (_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: "invalid mock credential",
            type: "invalid_request_error",
          },
        }),
      );
    },
    async (base) => {
      const stream = await (
        await chat(base, "失败测试", `session_${crypto.randomUUID()}`)
      ).text();
      assert.match(stream, /event: error/);
      assert.doesNotMatch(stream, /event: done/);
      const calls = await fetch(`${base}/api/calls`).then((r) => r.json());
      assert.equal(calls[0].status, "failed");
    },
  );
});

test("upstream disconnect is reported as failure", async () => {
  await withApp(
    (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      sendChunk(res, "部分内容");
      setTimeout(() => res.destroy(), 30);
    },
    async (base) => {
      const stream = await (
        await chat(base, "断网测试", `session_${crypto.randomUUID()}`)
      ).text();
      assert.match(stream, /event: error/);
      assert.doesNotMatch(stream, /event: done/);
      const calls = await fetch(`${base}/api/calls`).then((r) => r.json());
      assert.equal(calls[0].status, "failed");
    },
  );
});

test("parallel streams remain separate and active count is observable", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await withApp(
    async (req, res) => {
      const body = await readBody(req);
      const prompt = body.messages.at(-1).content;
      res.writeHead(200, { "content-type": "text/event-stream" });
      await gate;
      sendChunk(res, `回应:${prompt}`);
      sendChunk(res, "", true);
    },
    async (base) => {
      try {
        const [a, b] = await Promise.all([
          chat(base, "甲", `session_${crypto.randomUUID()}`),
          chat(base, "乙", `session_${crypto.randomUUID()}`),
        ]);
        const health = await fetch(`${base}/api/health`).then((r) => r.json());
        assert.equal(health.activeStreams, 2);
        release();
        const [left, right] = await Promise.all([a.text(), b.text()]);
        assert.match(left, /回应:甲/);
        assert.match(right, /回应:乙/);
        assert.match(left, /event: done/);
        assert.match(right, /event: done/);
        const calls = await fetch(`${base}/api/calls`).then((r) => r.json());
        assert.equal(calls.length, 2);
        assert.ok(calls.every((call) => call.status === "completed"));
      } finally {
        release();
      }
    },
  );
});

test("embedding provider indexes documents and retrieves by vector similarity", async () => {
  const seenInputs = [];
  const provider = await listen(async (req, res) => {
    if (req.url?.endsWith("/embeddings")) {
      const body = await readBody(req);
      seenInputs.push(body.input);
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      const data = inputs.map((input, index) => {
        const vector = /收入|收益/.test(input) ? [1, 0] : [0, 1];
        const bytes = Buffer.alloc(8);
        vector.forEach((value, dimension) =>
          bytes.writeFloatLE(value, dimension * 4),
        );
        return {
          object: "embedding",
          index,
          embedding: /无效向量/.test(input) ? "" : bytes.toString("base64"),
        };
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data,
          model: "mock-embedding",
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
      );
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    sendChunk(res, "已找到资料[1]");
    sendChunk(res, "", true);
  });
  try {
    await withApp(
      (_req, res) => res.end(),
      async (base) => {
        const add = (title, text) =>
          fetch(`${base}/api/knowledge`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title, text }),
          }).then((r) => r.json());
        const finance = await add(
          "财务说明",
          "本季度收入增长明显，财务团队已经完成报表核对。",
        );
        await add("天气说明", "今天气温较高，出门需要携带遮阳伞并注意补水。");
        assert.equal(finance.indexed, true);
        const stream = await (
          await chat(base, "收益如何？", `session_${crypto.randomUUID()}`, true)
        ).text();
        assert.match(JSON.stringify(seenInputs), /收益/);
        assert.match(stream, /event: sources/);
        assert.match(stream, /"mode":"vector"/);
        assert.match(stream, /财务说明/);
        assert.match(stream, /event: done/);
        const invalid = await fetch(`${base}/api/knowledge`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "异常资料",
            text: "这是一段用于模拟无效向量响应的资料内容。",
          }),
        });
        assert.equal(invalid.status, 500);
        assert.equal(
          (await fetch(`${base}/api/knowledge`).then((r) => r.json())).length,
          2,
        );
      },
      {
        CHAT_BASE_URL: provider.url,
        EMBEDDING_API_KEY: "mock-embedding-key",
        EMBEDDING_BASE_URL: provider.url,
        EMBEDDING_MODEL: "mock-embedding",
      },
    );
  } finally {
    await new Promise((resolve) => provider.server.close(resolve));
  }
});
