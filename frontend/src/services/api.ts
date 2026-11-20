import { RequestFailure, failureMessage } from "./errors";
import axios from "axios";
import type {
  CallRecord,
  DoneEvent,
  HealthStatus,
  KnowledgeDocument,
  Metrics,
  Session,
  SourcesEvent,
  StreamMeta,
} from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
export const api = axios.create({ baseURL: API_BASE, timeout: 15_000 });
api.interceptors.response.use(response=>response,cause=>{ if(cause instanceof Error) cause.message=failureMessage(cause); return Promise.reject(cause); });
export const getHealth = async () =>
  (await api.get<HealthStatus>("/api/health")).data;
export const getMetrics = async () =>
  (await api.get<Metrics>("/api/metrics")).data;
export const getCalls = async () =>
  (await api.get<CallRecord[]>("/api/calls")).data;
export const getSessions = async () =>
  (await api.get<Session[]>("/api/sessions")).data;
export const getSession = async (id: string) =>
  (await api.get<Session>(`/api/sessions/${encodeURIComponent(id)}`)).data;
export const createSession = async (id: string) =>
  (await api.post<Session>("/api/sessions", { sessionId: id })).data;
export const renameSession = async (id: string, title: string) =>
  api.patch(`/api/sessions/${encodeURIComponent(id)}`, { title });
export const deleteSession = async (id: string) =>
  api.delete(`/api/sessions/${encodeURIComponent(id)}`);
export const getDocuments = async () =>
  (await api.get<KnowledgeDocument[]>("/api/knowledge")).data;
export const addDocument = async (title: string, text: string) =>
  (await api.post<KnowledgeDocument>("/api/knowledge", { title, text })).data;
export const deleteDocument = async (id: string) =>
  api.delete(`/api/knowledge/${encodeURIComponent(id)}`);

interface StreamHandlers {
  onMeta: (meta: StreamMeta) => void;
  onSources: (value: SourcesEvent) => void;
  onToken: (token: string) => void;
  onDone: (value: DoneEvent) => void;
}
async function readChatStream(
  message: string,
  sessionId: string,
  useKnowledge: boolean,
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId, useKnowledge }),
    signal,
  });
  if (!response.ok || !response.body) {
    const detail = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new RequestFailure(`http_${response.status}`, response.status===429 ? "请求过于频繁，请稍后重试。" : response.status===401 || response.status===403 ? "请求未获授权，请检查服务配置。" : response.status>=500 ? "服务暂时不可用，请稍后重试。" : detail.error || "请求未成功，请检查输入后重试。",response.status!==401 && response.status!==403);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    completed = false;
  const dispatch = (raw: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    const payload = JSON.parse(data.join("\n")) as Record<string, unknown>;
    if (event === "meta") handlers.onMeta(payload as unknown as StreamMeta);
    if (event === "sources")
      handlers.onSources(payload as unknown as SourcesEvent);
    if (event === "token") handlers.onToken(String(payload.token || ""));
    if (event === "done") {
      completed = true;
      handlers.onDone(payload as unknown as DoneEvent);
    }
    if (event === "error")
      throw new RequestFailure(String(payload.code || "model_error"),String(payload.message || "生成失败"), payload.retryable !== false);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const event of events) dispatch(event);
    }
    buffer += decoder.decode();
    if (buffer.trim()) dispatch(buffer);
    if (!completed && !signal.aborted) throw new Error("连接中断，回复未完成");
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export const cleanCallRecords = async (scope: "older7" | "older30" | "all") =>
  (await api.post<{ deleted: number }>("/api/calls/cleanup", { scope })).data;

export interface StreamTimeouts { firstTokenMs:number; idleMs:number; totalMs:number }
export async function streamChat(message:string,sessionId:string,useKnowledge:boolean,signal:AbortSignal,handlers:StreamHandlers,timeouts:StreamTimeouts={firstTokenMs:60000,idleMs:45000,totalMs:180000}):Promise<void> {
  if(!navigator.onLine) throw new RequestFailure("offline","网络已断开，请恢复联网后重试。");
  const connection=new AbortController();
  let waitTimer:ReturnType<typeof setTimeout> | undefined;
  const abort=()=>connection.abort(signal.reason);
  const offline=()=>connection.abort(new RequestFailure("offline","网络已断开，回复已中断；联网后可手动重试。"));
  const arm=(ms:number,message:string)=>{clearTimeout(waitTimer);waitTimer=setTimeout(()=>connection.abort(new RequestFailure("stream_timeout",message)),ms);};
  signal.addEventListener("abort",abort,{once:true});
  window.addEventListener("offline",offline);
  if(signal.aborted) abort();
  arm(timeouts.firstTokenMs,"等待回复超时，请稍后重试。");
  const totalTimer=setTimeout(()=>connection.abort(new RequestFailure("stream_timeout","本次回复超过最长等待时间，请重试或缩短问题。")),timeouts.totalMs);
  try {
    await readChatStream(message,sessionId,useKnowledge,connection.signal,{
      ...handlers,
      onToken(token){if(token)arm(timeouts.idleMs,"回复长时间未更新，连接可能已中断，请重试。");handlers.onToken(token);},
      onDone(value){clearTimeout(waitTimer);clearTimeout(totalTimer);handlers.onDone(value);}
    });
  } catch(cause) {
    if(connection.signal.aborted) throw connection.signal.reason;
    throw cause instanceof RequestFailure || (cause instanceof Error && cause.name==="AbortError") ? cause : new RequestFailure("connection",failureMessage(cause));
  } finally {clearTimeout(waitTimer);clearTimeout(totalTimer);signal.removeEventListener("abort",abort);window.removeEventListener("offline",offline);}
}
