# 系统架构与数据流

```text
Vue 3 + TypeScript 工作台
       │ REST / SSE
       ▼
Express + TypeScript 网关
       ├─ 会话、调用记录 ── MySQL（可选）/ 本机 JSON
       ├─ 知识资料与向量 ── 本机 JSON
       └─ LangChain.js ───── 对话模型 / 嵌入模型
```

聊天请求先按会话 ID 读取最近 12 条消息。若用户开启知识库，服务端检索相关文档片段；在配置密钥时使用嵌入向量的余弦相似度，未配置时只能做关键词匹配演示。然后将历史消息、检索片段和当前问题交给模型，逐块通过 SSE 返回。事件包括 `meta`、`sources`、`token`、`done` 和 `error`。

取消回复会触发服务端 `AbortController`，记录为 `cancelled`。成功回答保存为会话消息，并记录首字时间、总耗时、输出字符数；失败也保留调用记录。看板指标基于实际记录计算，没有历史数据时显示空状态。

## 主要接口

| 路径 | 用途 |
| --- | --- |
| `GET /api/health`、`GET /api/metrics` | 服务状态与真实指标 |
| `GET/POST /api/sessions` | 会话列表与创建 |
| `GET/PATCH/DELETE /api/sessions/:id` | 读取消息、重命名、删除 |
| `POST /api/chat` | 流式问答 |
| `GET/POST /api/knowledge`、`DELETE /api/knowledge/:id` | 知识资料管理 |
| `GET /api/calls`、`POST /api/calls/cleanup` | 读取与清理调用记录 |

当前知识库只支持文本，向量索引采用本机 JSON 保存，适合小规模演示。后续若做团队使用，可迁移到专用向量存储，增加用户鉴权、权限隔离与检索质量评估。
