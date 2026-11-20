import "dotenv/config";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const { MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE } = process.env;
if (!MYSQL_HOST || !MYSQL_USER || MYSQL_DATABASE !== "ai_chat_dashboard") {
  throw new Error("迁移脚本仅操作已配置的 ai_chat_dashboard 数据库");
}

let state;
try {
  state = JSON.parse(await readFile(new URL("../data/state.json", import.meta.url), "utf8"));
} catch (error) {
  if (error?.code === "ENOENT") {
    console.log("没有本地会话数据，无需迁移");
    process.exit(0);
  }
  throw error;
}

const connection = await mysql.createConnection({ host: MYSQL_HOST, port: Number(MYSQL_PORT || 3306), user: MYSQL_USER, password: MYSQL_PASSWORD, database: MYSQL_DATABASE, charset: "utf8mb4" });
let importedSessions = 0, importedMessages = 0, importedCalls = 0;
try {
  await connection.beginTransaction();
  for (const session of state.sessions || []) {
    const [insert] = await connection.execute(
      "INSERT IGNORE INTO conversations(session_id,title,model_name,created_at,updated_at) VALUES(?,?,?,?,?)",
      [session.sessionId, session.title, session.model, new Date(session.createdAt), new Date(session.updatedAt)]
    );
    importedSessions += insert.affectedRows;
    const [rows] = await connection.execute("SELECT id FROM conversations WHERE session_id=?", [session.sessionId]);
    const conversationId = rows[0].id;
    const [countRows] = await connection.execute("SELECT COUNT(*) AS total FROM messages WHERE conversation_id=?", [conversationId]);
    if (Number(countRows[0].total) === 0) {
      for (const message of session.messages || []) {
        await connection.execute("INSERT INTO messages(conversation_id,role,content,created_at) VALUES(?,?,?,?)", [conversationId, message.role, message.content, new Date(message.createdAt)]);
        importedMessages += 1;
      }
    }
  }
  for (const call of state.calls || []) {
    const [result] = await connection.execute(
      "INSERT IGNORE INTO model_calls(conversation_id,trace_id,model_name,completion_tokens,duration_ms,first_token_latency_ms,output_chars,status,error_message,created_at) SELECT id,?,?,0,?,?,?,?,?,? FROM conversations WHERE session_id=?",
      [call.traceId, call.model, call.durationMs, call.firstTokenMs, call.outputChars, call.status, call.error || null, new Date(call.createdAt), call.sessionId]
    );
    importedCalls += result.affectedRows;
  }
  await connection.commit();
  console.log(`迁移完成：新增 ${importedSessions} 个会话、${importedMessages} 条消息、${importedCalls} 条调用记录；本地 JSON 保留`);
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
