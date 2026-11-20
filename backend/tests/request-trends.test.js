import test from "node:test";
import assert from "node:assert/strict";
import { buildRequestTrends } from "../dist/request-trends.js";
const now = Date.parse("2026-11-15T12:00:00Z");
const call = (offset) => ({ createdAt: new Date(now - offset).toISOString() });
test("range boundaries count each request exactly once and exclude future/invalid dates", () => {
  const trends = buildRequestTrends(
    [
      call(0),
      call(300000),
      call(3600000),
      call(86400000),
      call(7 * 86400000),
      call(-1),
      { createdAt: "invalid" },
    ],
    now,
  );
  assert.deepEqual(
    Object.values(trends).map((b) => b.length),
    [12, 24, 7],
  );
  assert.equal(
    trends["1h"].reduce((n, b) => n + b.count, 0),
    2,
  );
  assert.equal(
    trends["24h"].reduce((n, b) => n + b.count, 0),
    3,
  );
  assert.equal(
    trends["7d"].reduce((n, b) => n + b.count, 0),
    4,
  );
  assert.equal(trends["1h"][11].count, 1);
  assert.equal(trends["1h"][10].count, 1);
  for (const buckets of Object.values(trends)) {
    for (let i = 1; i < buckets.length; i++)
      assert.equal(buckets[i - 1].endAt, buckets[i].startAt);
    assert.equal(buckets.at(-1).endAt, new Date(now).toISOString());
  }
});
test("empty input produces zero buckets; statistics are not truncated at 5000 requests", () => {
  const empty = buildRequestTrends([], now);
  assert.ok(
    Object.values(empty)
      .flat()
      .every((b) => b.count === 0),
  );
  assert.equal(
    buildRequestTrends(
      Array.from({ length: 6000 }, () => call(1000)),
      now,
    )["24h"].reduce((n, b) => n + b.count, 0),
    6000,
  );
});
