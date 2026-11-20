import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 3000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  chatKey: process.env.CHAT_API_KEY || "",
  chatModel: process.env.CHAT_MODEL || "deepseek-flash",
  chatBaseUrl: process.env.CHAT_BASE_URL || "https://api.deepseek.com",
  embeddingKey: process.env.EMBEDDING_API_KEY || "",
  embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
  embeddingBaseUrl:
    process.env.EMBEDDING_BASE_URL || "https://api.openai.com/v1",
  mysql: {
    host: process.env.MYSQL_HOST || "",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "ai_chat_dashboard",
  },
};
