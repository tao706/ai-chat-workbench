<script setup lang="ts">
import { computed, ref } from "vue";
import type { TrendRange } from "../types";
import { storeToRefs } from "pinia";
import { useWorkspaceStore } from "../stores/workspace";
import { useChatStore } from "../stores/chat";
import { formatTime } from "../utils/format";
const { page, health, metrics, sessions, documents, statusLabel } =
  storeToRefs(useWorkspaceStore());
const { startSession, openSession } = useChatStore();
const trendRange = ref<TrendRange>("24h");
const trendOptions = [
  { value: "1h", label: "近 1 小时" },
  { value: "24h", label: "近 24 小时" },
  { value: "7d", label: "近 7 天" },
] as const;
const trendBuckets = computed(
  () =>
    metrics.value.trends?.[trendRange.value] ??
    (trendRange.value === "24h" ? metrics.value.buckets : []),
);
const trendTotal = computed(() =>
  trendBuckets.value.reduce((sum, bucket) => sum + bucket.count, 0),
);
const maxBucket = computed(() =>
  Math.max(1, ...trendBuckets.value.map((bucket) => bucket.count)),
);
const trendInterval = computed(
  () =>
    ({ "1h": "每 5 分钟统计", "24h": "每小时统计", "7d": "每 24 小时统计" })[
      trendRange.value
    ],
);
const trendStartLabel = computed(() => {
  const first = trendBuckets.value[0];
  return first?.startAt
    ? new Date(first.startAt).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        ...(trendRange.value !== "1h"
          ? { month: "2-digit", day: "2-digit" }
          : {}),
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : first?.label || "—";
});
function bucketTitle(bucket: (typeof trendBuckets.value)[number]) {
  if (!bucket.startAt || !bucket.endAt)
    return `${bucket.label}：${bucket.count} 次`;
  const format = (time: string) =>
    new Date(time).toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return `${format(bucket.startAt)} 至 ${format(bucket.endAt)}：${bucket.count} 次请求`;
}
</script>
<template>
  <section class="dashboard-home">
    <article class="welcome-card">
      <div class="welcome-top">
        <span class="eyebrow"><i></i> YOUR THINKING SPACE</span
        ><span class="welcome-tag">智能对话 · 工作空间</span>
      </div>
      <div class="welcome-copy">
        <p>每一个好想法，都值得继续。</p>
        <h2>把灵感，<br />聊成<span>答案。</span></h2>
        <p class="welcome-description">
          从一个问题出发，让思考有回应，让知识有连接。
        </p>
      </div>
      <div class="welcome-orbit" aria-hidden="true">
        <div class="orbit-circle"></div>
        <div class="orbit-circle second"></div>
        <span class="orbit-star">✳</span><span class="orbit-dot"></span>
      </div>
      <div class="welcome-bottom">
        <button class="welcome-start" @click="startSession">
          开启新对话 <span>↗</span></button
        ><button
          v-if="sessions.length"
          class="resume-link"
          @click="openSession(sessions[0]!.sessionId)"
        >
          继续上次对话 →</button
        ><span v-else class="welcome-note">你的下一次发现，从这里开始</span>
      </div>
    </article>

    <article class="insight-card">
      <div class="section-heading">
        <div>
          <span class="eyebrow">AT A GLANCE</span>
          <h3>对话脉搏</h3>
        </div>
        <span class="live-label"><i></i> 实时</span>
      </div>
      <div class="pulse-main">
        <div>
          <span class="metric-caption">近 24 小时请求</span
          ><strong>{{ metrics.requests24h }}<small>次</small></strong
          ><span class="muted-caption">每一次提问，都是思考的延伸</span>
        </div>
        <div
          class="success-ring"
          :style="{ '--success': `${metrics.successRate ?? 0}%` }"
        >
          <div>
            <strong
              >{{ metrics.successRate ?? "—"
              }}<small v-if="metrics.successRate !== null">%</small></strong
            ><span>请求成功率</span>
          </div>
        </div>
      </div>
      <div class="pulse-details">
        <div>
          <span>已保存会话</span
          ><strong>{{ metrics.sessions }}<small>个</small></strong>
        </div>
        <div>
          <span>平均首字时间</span
          ><strong
            >{{ metrics.avgFirstTokenMs ?? "—" }}<small>ms</small></strong
          >
        </div>
        <div>
          <span>平均输出速度</span
          ><strong
            >{{ metrics.avgCharsPerSecond ?? "—" }}<small>字/秒</small></strong
          >
        </div>
      </div>
    </article>

    <article class="trend-card">
      <div class="section-heading">
        <div>
          <span class="eyebrow">ACTIVITY</span>
          <h3>请求趋势</h3>
        </div>
        <div class="trend-total">
          <strong>{{ trendTotal }}</strong><span>次请求</span>
        </div>
      </div>
      <div class="trend-range" role="group" aria-label="统计时间范围">
        <button
          v-for="option in trendOptions"
          :key="option.value"
          :aria-pressed="trendRange === option.value"
          :class="{ active: trendRange === option.value }"
          @click="trendRange = option.value"
        >
          {{ option.label }}
        </button>
      </div>
      <div class="activity-plot">
        <div class="plot-guides" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        <div v-if="trendTotal" class="activity-bars">
          <div
            v-for="(bucket, index) in trendBuckets"
            :key="index"
            class="activity-column"
            :class="{
              latest: index === trendBuckets.length - 1,
              zero: bucket.count === 0,
            }"
            :title="bucketTitle(bucket)"
          >
            <span v-if="bucket.count" class="bar-value">{{
              bucket.count
            }}</span>
            <div
              :style="{
                height: bucket.count
                  ? `${Math.max(4, (bucket.count / maxBucket) * 100)}%`
                  : '0px',
              }"
            ></div>
          </div>
        </div>
        <div v-if="!trendTotal" class="trend-empty" role="status">
          该时间段暂无请求，开始对话后可查看趋势。
        </div>
      </div>
      <div class="plot-axis">
        <span>{{ trendStartLabel }}</span><span>{{ trendInterval }}</span
        ><span>{{ trendBuckets.at(-1)?.label || "—" }}</span>
      </div>
    </article>

    <article class="conversation-card">
      <div class="section-heading">
        <div>
          <span class="eyebrow">PICK UP WHERE YOU LEFT OFF</span>
          <h3>接着聊</h3>
        </div>
        <button
          class="all-conversations"
          @click="page = 'sessions'"
          aria-label="查看全部会话"
        >
          ↗
        </button>
      </div>
      <div v-if="!sessions.length" class="empty-conversations">
        <span>✦</span><strong>等待第一段对话</strong>
        <p>记录问题，也留下新的想法。</p>
        <button class="text-button" @click="startSession">开始对话 →</button>
      </div>
      <button
        v-for="(item, index) in sessions.slice(0, 3)"
        :key="item.sessionId"
        class="conversation-preview"
        @click="openSession(item.sessionId)"
      >
        <span class="conversation-index">{{
          String(index + 1).padStart(2, "0")
        }}</span><span class="conversation-info"
          ><strong>{{ item.title }}</strong
          ><small>{{ formatTime(item.updatedAt) }}</small></span
        ><span class="conversation-arrow">↗</span>
      </button>
    </article>

    <div class="workspace-strip">
      <div class="workspace-connection">
        <span
          class="status-dot"
          :class="{ offline: health.status !== 'ok' }"
        ></span
        ><strong>{{ statusLabel }}</strong
        ><span>{{
          metrics.activeStreams
            ? `${metrics.activeStreams} 个请求进行中`
            : "已就绪，随时开始"
        }}</span>
      </div>
      <div class="workspace-links">
        <button @click="page = 'knowledge'">
          <span>▧</span> 知识库 <b>{{ documents.length }}</b> ↗</button
        ><button @click="page = 'calls'">调用记录 ↗</button>
      </div>
    </div>
  </section>
</template>
