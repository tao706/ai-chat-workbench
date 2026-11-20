import "dotenv/config";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const { MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE } = process.env;
if (!MYSQL_HOST || !MYSQL_USER || MYSQL_DATABASE !== "ai_chat_dashboard") {
  throw new Error("请先在 backend/.env 配置本机 MySQL；初始化脚本仅操作 ai_chat_dashboard 数据库");
}

const schema = await readFile(new URL("../../database/schema.sql", import.meta.url), "utf8");
const connection = await mysql.createConnection({
  host: MYSQL_HOST,
  port: Number(MYSQL_PORT || 3306),
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  multipleStatements: true
});
try {
  await connection.query(schema);
  const [rows] = await connection.query("SELECT table_name FROM information_schema.tables WHERE table_schema=? AND table_name IN ('conversations','messages','model_calls')", [MYSQL_DATABASE]);
  if (rows.length !== 3) throw new Error("数据库初始化不完整");
  console.log("ai_chat_dashboard 数据库和 3 张业务表已就绪");
} finally {
  await connection.end();
}
