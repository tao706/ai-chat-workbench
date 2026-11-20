import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  cleanupCutoff,
  CALL_RETENTION_DAYS,
  CALL_CLEANUP_INTERVAL,
} from "../dist/call-retention.js";
test("retention cutoff is 30 days and cleanup is scheduled hourly", () => {
  assert.equal(CALL_RETENTION_DAYS, 30);
  assert.equal(CALL_CLEANUP_INTERVAL, 3600000);
  assert.equal(cleanupCutoff("older30", 40 * 86400000), 10 * 86400000);
  assert.equal(cleanupCutoff("older7", 40 * 86400000), 33 * 86400000);
  assert.equal(cleanupCutoff("all", 1000), 1000);
});
test("startup retention and manual cleanup remove only calls; invalid scope cannot delete", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "chat-retention-"));
  const id = "session_cleanup123456",
    now = Date.now(),
    at = new Date(now).toISOString();
  const session = {
    sessionId: id,
    title: "保留的会话",
    model: "demo",
    createdAt: at,
    updatedAt: at,
    messages: [
      { id: "m1", role: "user", content: "保留聊天内容", createdAt: at },
    ],
  };
  const calls = [35, 10, 0].map((days) => ({
    traceId: `trace_${days}`,
    sessionId: id,
    model: "demo",
    status: "completed",
    durationMs: 100,
    firstTokenMs: 10,
    outputChars: 10,
    createdAt: new Date(now - days * 86400000).toISOString(),
  }));
  await writeFile(
    path.join(temp, "state.json"),
    JSON.stringify({ sessions: [session], calls }),
  );
  const base = "http://127.0.0.1:32339";
  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      PORT: "32339",
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
        ready = (await fetch(base + "/api/health")).ok;
        if (ready) break;
      } catch {}
      await delay(200);
    }
    assert.ok(ready);
    const get = async (url) => (await fetch(base + url)).json();
    const clean = (scope) =>
      fetch(base + "/api/calls/cleanup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope }),
      });
    assert.deepEqual(
      (await get("/api/calls")).map((c) => c.traceId),
      ["trace_0", "trace_10"],
    );
    const docResponse = await fetch(base + "/api/knowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "保留资料",
        text: "这是一份验证清理操作不会删除知识库资料的测试文档内容。",
      }),
    });
    assert.equal(docResponse.status, 201);
    assert.equal((await clean("invalid")).status, 400);
    assert.equal((await get("/api/calls")).length, 2);
    assert.deepEqual(await (await clean("older30")).json(), { deleted: 0 });
    assert.deepEqual(await (await clean("older7")).json(), { deleted: 1 });
    assert.equal((await get("/api/calls")).length, 1);
    assert.deepEqual(await (await clean("all")).json(), { deleted: 1 });
    assert.equal((await get("/api/calls")).length, 0);
    assert.deepEqual(
      (await get("/api/sessions/" + id)).messages,
      session.messages,
    );
    assert.equal((await get("/api/knowledge")).length, 1);
    assert.equal((await get("/api/metrics")).requests24h, 0);
    assert.deepEqual(await (await clean("all")).json(), { deleted: 0 });
  } finally {
    const ended = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await ended;
    await rm(temp, { recursive: true, force: true });
  }
});
