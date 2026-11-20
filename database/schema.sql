CREATE DATABASE IF NOT EXISTS ai_chat_dashboard
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE ai_chat_dashboard;

CREATE TABLE IF NOT EXISTS conversations (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  session_id VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL DEFAULT '新会话',
  model_name VARCHAR(100) NOT NULL,
  status ENUM('active', 'archived', 'error') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_conversations_updated_at (updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  role ENUM('system', 'user', 'assistant', 'tool') NOT NULL,
  content LONGTEXT NOT NULL,
  token_count INT UNSIGNED NOT NULL DEFAULT 0,
  first_token_latency_ms INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_messages_conversation
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    ON DELETE CASCADE,
  INDEX idx_messages_conversation_created (conversation_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS model_calls (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  trace_id VARCHAR(64) NOT NULL UNIQUE,
  model_name VARCHAR(100) NOT NULL,
  prompt_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  completion_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  duration_ms INT UNSIGNED NULL,
  first_token_latency_ms INT UNSIGNED NULL,
  output_chars INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('streaming', 'completed', 'cancelled', 'failed') NOT NULL,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_calls_conversation
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    ON DELETE CASCADE,
  INDEX idx_calls_created_at (created_at)
) ENGINE=InnoDB;

