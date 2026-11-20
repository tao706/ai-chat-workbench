import { cleanCalls } from "./database.js";
export const CALL_RETENTION_DAYS = 30;
export const CALL_CLEANUP_INTERVAL = 3600_000;
export type CleanupScope = "older7" | "older30" | "all";
export function cleanupCutoff(scope: CleanupScope, now = Date.now()) {
  const days =
    scope === "older7" ? 7 : scope === "older30" ? CALL_RETENTION_DAYS : 0;
  return now - days * 24 * 3600_000;
}
export async function runCallRetention() {
  try {
    await cleanCalls(cleanupCutoff("older30"));
  } catch (cause) {
    console.error("过期调用记录清理失败，将在下一次任务重试", cause);
  }
}
