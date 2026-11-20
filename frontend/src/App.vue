<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from "vue";
import { storeToRefs } from "pinia";
import { ElConfigProvider } from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { useWorkspaceStore, type Page } from "./stores/workspace";
import { useChatStore } from "./stores/chat";
import { RouterView } from "vue-router";
const workspace = useWorkspaceStore(),
  chat = useChatStore();
const { page, health, sessions, statusLabel, error, refreshing, online, loadError } =
  storeToRefs(workspace);
const { manualRefresh, refresh } = workspace;
const { startSession } = chat;
const nav: { id: Page; label: string; description: string; path: string }[] = [
  {
    id: "overview",
    label: "总览",
    description: "工作空间与使用趋势",
    path: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  },
  {
    id: "sessions",
    label: "会话",
    description: "继续交流与查看历史",
    path: "M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z M7 9h10 M7 13h6",
  },
  {
    id: "knowledge",
    label: "知识库",
    description: "管理资料与回答依据",
    path: "M4 4h6a3 3 0 0 1 2 3v14a4 4 0 0 0-4-2H3V4z M20 4h-6a3 3 0 0 0-2 3 M12 21a4 4 0 0 1 4-2h5V4h-1",
  },
  {
    id: "calls",
    label: "调用记录",
    description: "查看请求状态与耗时",
    path: "M5 3h14v18H5z M9 8h6 M9 12h6 M9 16h4",
  },
];
const pageTitle = computed(
  () => nav.find((item) => item.id === page.value)?.label || "总览",
);
let timer: number | undefined;
function onOffline(){ online.value=false; }
async function onOnline(){ online.value=true; await refresh(); }

onMounted(() => {
  window.addEventListener("offline",onOffline);
  window.addEventListener("online",onOnline);
  void refresh();
  timer = window.setInterval(() => void refresh(), 15000);
});
onBeforeUnmount(() => {
  window.removeEventListener("offline",onOffline);
  window.removeEventListener("online",onOnline);
  chat.stop();
  if (timer) window.clearInterval(timer);
});
</script>
<template>
  <ElConfigProvider :locale="zhCn">
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <span class="logo" aria-hidden="true"
            ><svg
              width="21"
              height="21"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z"
              />
              <path d="M7 9h10M7 13h6" /></svg
          ></span>
          <div>AI 对话工作台<small>会话 · 知识库 · 运行监控</small></div>
        </div>
        <p class="nav-label">工作空间</p>
        <nav aria-label="主导航">
          <button
            v-for="item in nav"
            :key="item.id"
            :class="{ active: page === item.id }"
            :aria-current="page === item.id ? 'page' : undefined"
            @click="page = item.id"
          >
            <span class="nav-icon" aria-hidden="true"
              ><svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path :d="item.path" /></svg></span
            ><span class="nav-copy"
              ><strong>{{ item.label }}</strong
              ><small>{{ item.description }}</small></span
            ><i v-if="item.id === 'sessions'">{{ sessions.length }}</i
            ><span v-else class="nav-indicator" aria-hidden="true">›</span>
          </button>
        </nav>
        <div class="environment">
          <div>
            <strong>运行状态</strong
            ><span
              class="status-dot"
              :class="{ offline: health.status !== 'ok' }"
            ></span>
          </div>
          <small
            >{{ statusLabel }}<br />{{
              health.database === "connected"
                ? "数据已保存"
                : health.database === "local"
                  ? "本机保存"
                  : "存储连接异常"
            }}</small
          >
        </div>
      </aside>

      <main>
        <header>
          <div>
            <p>工作空间 / {{ pageTitle }}</p>
            <h1>{{ pageTitle }}</h1>
          </div>
          <div class="actions">
            <button
              class="icon-button refresh-button"
              aria-label="刷新"
              :title="refreshing ? '正在刷新…' : '刷新数据'"
              :disabled="refreshing"
              :aria-busy="refreshing"
              @click="manualRefresh"
            >
              <span :class="{ spinning: refreshing }">↻</span></button
            ><button class="primary" @click="startSession">＋ 新建会话</button>
          </div>
        </header>
        <div v-if="!online" class="offline-banner" role="status">网络已断开，已加载的内容仍可查看。恢复联网后会自动检查服务，不会自动重发问题。</div>
        <p v-if="error || loadError" class="error global-error" role="alert">{{ error || loadError }}</p>
        <div v-if="health.model === 'demo'" class="demo-banner">
          体验模式：当前回复用于演示交互，不代表真实模型生成。配置对话服务后可使用智能问答。
        </div>

        <RouterView />
      </main>
    </div>
  </ElConfigProvider>
</template>
