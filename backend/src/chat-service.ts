import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { config } from "./config.js";
import type { Passage } from "./knowledge.js";
import type { StoredMessage } from "./local-store.js";

export function modelMode(): "connected" | "demo" {
  return config.chatKey ? "connected" : "demo";
}

export async function* generateTokens(
  message: string,
  history: StoredMessage[],
  passages: Passage[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  if (!config.chatKey) {
    const context = history.length
      ? `本会话已有 ${history.length} 条历史消息。`
      : "这是新会话。";
    const found = passages.length
      ? `\n\n匹配到的资料：${passages.map((p, i) => `[${i + 1}]《${p.title}》${p.text.slice(0, 100)}`).join("；")}`
      : "";
    const answer = `当前为演示回复，尚未接入真实模型。${context}\n\n你的问题：${message}${found}\n\n配置模型后可生成结合历史消息与引用资料的真实回答。`;
    for (let index = 0; index < answer.length; index += 2) {
      if (signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, 28));
      yield answer.slice(index, index + 2);
    }
    return;
  }

  const model = new ChatOpenAI({
    apiKey: config.chatKey,
    model: config.chatModel,
    configuration: { baseURL: config.chatBaseUrl },
    timeout: 60_000,
    maxRetries: 0,
    temperature: 0.7,
    streaming: true,
  });

  const references = passages
    .map((p, i) => `[${i + 1}] 来源：《${p.title}》第 ${p.chunk} 段\n${p.text}`)
    .join("\n\n");
  const stream = await model.stream(
    [
      new SystemMessage(
        `你是一位专业的中文助手。回答简洁、可执行。若提供参考资料，只能基于资料陈述相关事实，并在相应句末标注[序号]；资料不足要明确说明，不得编造来源。参考资料：\n${references || "无"}`,
      ),
      ...history
        .slice(-12)
        .map((item) =>
          item.role === "user"
            ? new HumanMessage(item.content)
            : new AIMessage(item.content),
        ),
      new HumanMessage(message),
    ],
    { signal },
  );

  for await (const chunk of stream) {
    if (signal.aborted) return;
    const content = chunk.content;
    if (typeof content === "string") yield content;
  }
}
