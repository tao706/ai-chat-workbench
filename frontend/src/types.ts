export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  meta?: string;
}
export interface Session {
  sessionId: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}
export interface StreamMeta {
  traceId: string;
  model: string;
  startedAt: number;
  mode: "connected" | "demo";
}
export interface Source {
  documentId: string;
  title: string;
  chunk: number;
  text: string;
  score: number;
}
export interface SourcesEvent {
  mode: "vector" | "keyword";
  passages: Source[];
}
export interface DoneEvent {
  traceId: string;
  durationMs: number;
  firstTokenMs: number | null;
  outputChars: number;
}
export interface HealthStatus {
  status: "ok" | "degraded";
  database: "connected" | "local" | "error";
  model: "connected" | "demo";
  activeStreams: number;
  uptime: number;
}
export interface Metrics {
  activeStreams: number;
  sessions: number;
  requests24h: number;
  successRate: number | null;
  avgFirstTokenMs: number | null;
  avgCharsPerSecond: number | null;
  buckets: TrendBucket[];
  trends?: Record<TrendRange, TrendBucket[]>;
}
export interface CallRecord {
  traceId: string;
  sessionId: string;
  model: string;
  status: "completed" | "cancelled" | "failed";
  durationMs: number;
  firstTokenMs: number | null;
  outputChars: number;
  error?: string;
  createdAt: string;
}
export interface KnowledgeDocument {
  id: string;
  title: string;
  createdAt: string;
  chars: number;
  chunkCount: number;
  indexed: boolean;
}

export type TrendRange = "1h" | "24h" | "7d";
export interface TrendBucket {
  label: string;
  count: number;
  startAt?: string;
  endAt?: string;
}
