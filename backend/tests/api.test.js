import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

test("session, metrics, knowledge and streaming demo flow", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "ai-stream-test-"));
  const port = 32337;
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      APP_DATA_DIR: temp,
      MYSQL_HOST: "",
      MYSQL_USER: "",
      CHAT_API_KEY: "",
      EMBEDDING_API_KEY: "",
    },
    stdio: "ignore",
  });
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try {
        ready = (await fetch(`${base}/api/health`)).ok;
        if (ready) break;
      } catch {}
      await delay(200);
    }
    assert.equal(ready, true, "server did not start");
    const id = `session_${crypto.randomUUID()}`;
    const json = async (url, method = "GET", body) => {
      const response = await fetch(`${base}${url}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.ok(response.ok, `${method} ${url}: ${response.status}`);
      return response.json();
    };
    await json("/api/sessions", "POST", { sessionId: id });
    const doc = await json("/api/knowledge", "POST", {
      title: "产品手册",
      text: "产品支持企业级知识检索，回答应当标明文档来源。文档管理员负责更新资料。",
    });
    assert.equal(doc.indexed, false);
    const chat = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: id,
        message: "产品支持什么知识检索？",
        useKnowledge: true,
      }),
    });
    assert.equal(chat.status, 200);
    const stream = await chat.text();
    assert.match(stream, /event: sources/);
    assert.match(stream, /产品手册/);
    assert.match(stream, /event: done/);
    const session = await json(`/api/sessions/${id}`);
    assert.equal(session.messages.length, 2);
    const second = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: id,
        message: "继续解释",
        useKnowledge: false,
      }),
    });
    const secondStream = await second.text();
    const secondAnswer = [
      ...secondStream.matchAll(/event: token\ndata: (\{[^\n]+\})/g),
    ]
      .map((match) => JSON.parse(match[1]).token)
      .join("");
    assert.match(secondAnswer, /本会话已有 2 条历史消息/);
    assert.equal((await json(`/api/sessions/${id}`)).messages.length, 4);
    const aborter = new AbortController();
    const interrupted = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: id,
        message: "这条请求会被停止",
        useKnowledge: false,
      }),
      signal: aborter.signal,
    });
    await interrupted.body.getReader().read();
    aborter.abort();
    let cancelled = false;
    for (let i = 0; i < 20; i++) {
      if (
        (await json("/api/calls")).some((call) => call.status === "cancelled")
      ) {
        cancelled = true;
        break;
      }
      await delay(100);
    }
    assert.equal(cancelled, true, "cancelled request was not recorded");
    const metrics = await json("/api/metrics");
    assert.equal(metrics.sessions, 1);
    assert.equal(metrics.requests24h, 3);
    assert.equal(metrics.successRate, 66.7);
    await json(`/api/sessions/${id}`, "PATCH", { title: "检索演示" });
    assert.equal((await json(`/api/sessions/${id}`)).title, "检索演示");
    await json(`/api/knowledge/${doc.id}`, "DELETE");
    await json(`/api/sessions/${id}`, "DELETE");
    assert.equal((await json("/api/sessions")).length, 0);
  } finally {
    child.kill();
    await rm(temp, { recursive: true, force: true });
  }
});
