-- 仅用于从旧版 schema 升级；新安装直接执行 schema.sql。
USE ai_chat_dashboard;
ALTER TABLE model_calls
  ADD COLUMN first_token_latency_ms INT UNSIGNED NULL AFTER duration_ms,
  ADD COLUMN output_chars INT UNSIGNED NOT NULL DEFAULT 0 AFTER first_token_latency_ms;
