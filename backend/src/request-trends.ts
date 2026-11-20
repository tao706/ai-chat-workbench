export type TrendRange = "1h" | "24h" | "7d";
export interface TrendBucket {
  label: string;
  startAt: string;
  endAt: string;
  count: number;
}
const ranges: Record<TrendRange, { count: number; step: number }> = {
  "1h": { count: 12, step: 5 * 60_000 },
  "24h": { count: 24, step: 3600_000 },
  "7d": { count: 7, step: 24 * 3600_000 },
};
export function buildRequestTrends(
  calls: { createdAt: string }[],
  now = Date.now(),
) {
  const trends = {} as Record<TrendRange, TrendBucket[]>;
  for (const range of Object.keys(ranges) as TrendRange[]) {
    const { count, step } = ranges[range];
    const start = now - count * step;
    const buckets: TrendBucket[] = Array.from({ length: count }, (_, index) => {
      const startAt = start + index * step,
        endAt = startAt + step;
      const date = new Date(endAt);
      const label = date.toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        ...(range !== "1h" ? { month: "2-digit", day: "2-digit" } : {}),
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      return {
        label,
        startAt: new Date(startAt).toISOString(),
        endAt: date.toISOString(),
        count: 0,
      };
    });
    for (const call of calls) {
      const time = new Date(call.createdAt).getTime();
      if (!Number.isFinite(time) || time <= start || time > now) continue;
      const index = Math.min(count - 1, Math.ceil((time - start) / step) - 1);
      buckets[index].count++;
    }
    trends[range] = buckets;
  }
  return trends;
}
