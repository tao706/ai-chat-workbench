import { router } from "../router";
import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { ElMessage } from "element-plus";
import "element-plus/es/components/message/style/css";
import {
  getHealth,
  getMetrics,
  getSessions,
  getCalls,
  getDocuments,
} from "../services/api";
import type {
  HealthStatus,
  Metrics,
  Session,
  CallRecord,
  KnowledgeDocument,
} from "../types";
export type Page = "overview" | "sessions" | "knowledge" | "calls";
export const useWorkspaceStore = defineStore("workspace", () => {
  const online=ref(navigator.onLine), loadError=ref("");
  const page = computed<Page>({
    get:()=> (router.currentRoute.value.name as Page) || "overview",
    set:(value)=>{void router.push({name:value});}
  });
  const
    error = ref(""),
    notice = ref(""),
    refreshing = ref(false);
  const health = ref<HealthStatus>({
    status: "degraded",
    database: "local",
    model: "demo",
    activeStreams: 0,
    uptime: 0,
  });
  const metrics = ref<Metrics>({
    activeStreams: 0,
    sessions: 0,
    requests24h: 0,
    successRate: null,
    avgFirstTokenMs: null,
    avgCharsPerSecond: null,
    buckets: [],
  });
  const sessions = ref<Session[]>([]),
    calls = ref<CallRecord[]>([]),
    documents = ref<KnowledgeDocument[]>([]);
  const statusLabel = computed(() =>
    !online.value ? "网络已断开" : health.value.status === "ok" ? "服务正常" : "服务异常",
  );
  const maxBucket = computed(() =>
    Math.max(1, ...metrics.value.buckets.map((b) => b.count)),
  );
  let messageHandle: ReturnType<typeof ElMessage.success> | undefined;
  function showNotice(value: string) {
    notice.value = value;
    messageHandle?.close();
    messageHandle = ElMessage.success({
      message: value,
      duration: 4000,
      customClass: "workbench-message",
    });
  }
  let refreshInFlight: Promise<boolean> | undefined;
  function refresh(): Promise<boolean> {
    if (!online.value) return Promise.resolve(false);
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        const [h, m, s, c, d] = await Promise.all([
          getHealth(),
          getMetrics(),
          getSessions(),
          getCalls(),
          getDocuments(),
        ]);
        loadError.value="";
        health.value = h;
        metrics.value = m;
        sessions.value = s;
        calls.value = c;
        documents.value = d;
        return true;
      } catch (cause) {
        loadError.value = cause instanceof Error ? cause.message : "无法连接服务";
        health.value.status = "degraded";
        return false;
      }
    })().finally(() => {
      refreshInFlight = undefined;
    });
    return refreshInFlight;
  }
  async function manualRefresh() {
    if (refreshing.value) return;
    refreshing.value = true;
    error.value = "";
    loadError.value="";
    notice.value = "";
    messageHandle?.close();
    try {
      if (await refresh()) showNotice("已刷新，当前显示最新数据。");
    } finally {
      refreshing.value = false;
    }
  }

  return {
    online, loadError,
    page,
    error,
    notice,
    refreshing,
    health,
    metrics,
    sessions,
    calls,
    documents,
    statusLabel,
    maxBucket,
    refresh,
    manualRefresh,
    showNotice,
  };
});
