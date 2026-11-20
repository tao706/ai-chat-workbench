import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}
export interface Session {
  sessionId: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredMessage[];
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
interface State {
  sessions: Session[];
  calls: CallRecord[];
}

const file = path.join(
  process.env.APP_DATA_DIR ||
    fileURLToPath(new URL("../data/", import.meta.url)),
  "state.json",
);
let state: State | undefined;
let queue = Promise.resolve();

async function load(): Promise<State> {
  if (state) return state;
  try {
    state = JSON.parse(await fs.readFile(file, "utf8")) as State;
  } catch {
    state = { sessions: [], calls: [] };
  }
  return state;
}

async function persist(): Promise<void> {
  const current = await load();
  queue = queue.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await fs.writeFile(temp, JSON.stringify(current, null, 2));
    await fs.rename(temp, file);
  });
  await queue;
}

export async function listLocalSessions(): Promise<Session[]> {
  return [...(await load()).sessions].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}
export async function getLocalSession(
  id: string,
): Promise<Session | undefined> {
  return (await load()).sessions.find((s) => s.sessionId === id);
}
export async function createLocalSession(id: string): Promise<Session> {
  const current = await load();
  const existing = current.sessions.find((s) => s.sessionId === id);
  if (existing) return existing;
  const at = new Date().toISOString();
  const session = {
    sessionId: id,
    title: "新会话",
    model: "演示模型",
    createdAt: at,
    updatedAt: at,
    messages: [],
  };
  current.sessions.push(session);
  await persist();
  return session;
}
export async function renameLocalSession(
  id: string,
  title: string,
): Promise<boolean> {
  const session = await getLocalSession(id);
  if (!session) return false;
  session.title = title;
  session.updatedAt = new Date().toISOString();
  await persist();
  return true;
}
export async function deleteLocalSession(id: string): Promise<boolean> {
  const current = await load();
  const n = current.sessions.length;
  current.sessions = current.sessions.filter((s) => s.sessionId !== id);
  current.calls = current.calls.filter((c) => c.sessionId !== id);
  if (n === current.sessions.length) return false;
  await persist();
  return true;
}
export async function saveLocalExchange(
  id: string,
  user: string,
  assistant: string,
  model: string,
): Promise<void> {
  const session = await createLocalSession(id);
  const at = new Date().toISOString();
  if (session.title === "新会话") session.title = user.slice(0, 28);
  session.model = model;
  session.updatedAt = at;
  session.messages.push(
    { id: crypto.randomUUID(), role: "user", content: user, createdAt: at },
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content: assistant,
      createdAt: at,
    },
  );
  await persist();
}
export async function saveLocalCall(call: CallRecord): Promise<void> {
  (await load()).calls.push(call);
  await persist();
}
export async function listLocalCalls(): Promise<CallRecord[]> {
  return [...(await load()).calls].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export async function cleanLocalCalls(before: number): Promise<number> {
  const current = await load();
  const kept = current.calls.filter(
    (call) => new Date(call.createdAt).getTime() > before,
  );
  const deleted = current.calls.length - kept.length;
  if (deleted) {
    current.calls = kept;
    await persist();
  }
  return deleted;
}
