<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useWorkspaceStore } from "../stores/workspace";
import { useChatStore } from "../stores/chat";
import DeleteSessionDialog from "./DeleteSessionDialog.vue";
import type { Session } from "../types";
import { formatTime } from "../utils/format";
const workspace = useWorkspaceStore(),
  chat = useChatStore();
const { sessions, health, documents, statusLabel, error, online } =
  storeToRefs(workspace);
const {
  loadingSession, sessionReady, sessionLoadError,
  failedRequests,
  sessionId,
  messages,
  prompt,
  streaming,
  sources,
  sourceMode,
  useKnowledge,
  currentSession,
  scrollVersion,
} = storeToRefs(chat);
const { openSession, send, stop, retryReply } = chat;
const search = ref(""),
  editingId = ref(""),
  editingTitle = ref("");
const messagesEl = ref<HTMLElement>();
const route=useRoute(), followLatest=ref(true), unseenReply=ref(false);
let returnFrame:number | undefined;
let returningToLatest=false;
function cancelReturn(){
 if(returnFrame!==undefined) cancelAnimationFrame(returnFrame);
 returnFrame=undefined; returningToLatest=false;
}
function interruptReturn(){cancelReturn();followLatest.value=false;}
function trackScroll(){
 if(returningToLatest)return;
 const el=messagesEl.value;if(!el)return;
 followLatest.value=el.scrollHeight-el.scrollTop-el.clientHeight<64;
 if(followLatest.value)unseenReply.value=false;
}
function pauseFollow(event:WheelEvent){if(event.deltaY<0)interruptReturn();}
async function backToLatest(){
 cancelReturn(); followLatest.value=true; unseenReply.value=false;
 returningToLatest=true;
 await nextTick();
 const el=messagesEl.value;
 if(!el){cancelReturn();return;}
 if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){
  cancelReturn();await scrollBottom();return;
 }
 const start=el.scrollTop, startedAt=performance.now();
 const frame=(now:number)=>{
  const progress=Math.min(1,(now-startedAt)/700);
  const eased=1-Math.pow(1-progress,3);
  const target=Math.max(0,el.scrollHeight-el.clientHeight);
  el.scrollTop=start+(target-start)*eased;
  if(progress<1) returnFrame=requestAnimationFrame(frame);
  else {returnFrame=undefined;returningToLatest=false;followLatest.value=true;unseenReply.value=false;}
 };
 returnFrame=requestAnimationFrame(frame);
}
watch(()=>route.params.sessionId, async (value,_previous,onCleanup)=>{
 cancelReturn();
 let stale=false;onCleanup(()=>{stale=true;cancelReturn();});
 followLatest.value=true;unseenReply.value=false;
 await chat.loadSession(typeof value==="string"?value:undefined);
 if(!stale)await scrollBottom();
},{immediate:true});
const filteredSessions = computed(() =>
  sessions.value.filter((s) =>
    s.title.toLowerCase().includes(search.value.trim().toLowerCase()),
  ),
);
const sessionToDelete = ref<Session>(),
  deletionOpen = ref(false);
function requestSessionDeletion(item: Session) {
  sessionToDelete.value = item;
  deletionOpen.value = true;
}
async function scrollBottom() {
  await nextTick();
  messagesEl.value?.scrollTo({
    top: messagesEl.value.scrollHeight,
    behavior: "auto",
  });
}
watch(scrollVersion, async()=>{
 await nextTick();
 if(returningToLatest)return;
 if(followLatest.value) await scrollBottom(); else unseenReply.value=true;
}, { flush:"post" });
onMounted(scrollBottom);
onBeforeUnmount(()=>{cancelReturn();chat.leaveConversation();});
function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void send();
  }
}
async function commitTitle(id: string) {
  const title = editingTitle.value.trim();
  editingId.value = "";
  if (!title) return;
  try {
    await chat.renameConversation(id, title);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "重命名失败";
  }
}
</script>
<template>
  <section class="conversation-layout">
    <aside class="panel session-list">
      <div class="title">
        <b>会话列表</b><small>{{ sessions.length }} 个</small>
      </div>
      <input
        v-model="search"
        class="field"
        placeholder="搜索会话"
        aria-label="搜索会话"
      />
      <div v-if="!filteredSessions.length" class="empty-block">
        暂无匹配的会话
      </div>
      <div
        v-for="item in filteredSessions"
        :key="item.sessionId"
        class="session-row"
        :class="{ selected: sessionId === item.sessionId }"
      >
        <button class="session-open" @click="openSession(item.sessionId)">
          <strong>{{ item.title }}</strong><small>{{
            formatTime(item.updatedAt)
          }}</small>
        </button>
        <div class="row-actions">
          <button
            title="重命名"
            @click="
              editingId = item.sessionId;
              editingTitle = item.title;
            "
          >
            ✎</button
          ><button
            class="session-delete"
            :title="`删除会话：${item.title}`"
            :aria-label="`删除会话：${item.title}`"
            @click="requestSessionDeletion(item)"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
            </svg>
          </button>
        </div>
        <form
          v-if="editingId === item.sessionId"
          class="rename-form"
          @submit.prevent="commitTitle(item.sessionId)"
        >
          <input
            v-model="editingTitle"
            class="field"
            maxlength="80"
            aria-label="会话名称"
          /><button class="small-primary">保存</button>
        </form>
      </div>
    </aside>
    <article class="panel chat-panel">
      <div class="panel-head">
        <div class="identity">
          <span>AI</span>
          <div>
            <b>{{ currentSession?.title || "新会话" }}</b><small
              >{{ messages.length }} 条消息 ·
              {{ health.model === "demo" ? "体验模式" : "智能回复" }}</small
            >
          </div>
        </div>
        <div class="connection">
          <span
            class="status-dot"
            :class="{ offline: health.status !== 'ok' }"
          ></span
          >{{ streaming ? "正在回复" : statusLabel }}
        </div>
      </div>
      <div ref="messagesEl" class="messages" @scroll="trackScroll" @wheel.passive="pauseFollow" @touchstart.passive="interruptReturn">
        <div v-if="loadingSession" class="empty" role="status">正在加载会话…</div>
        <div v-else-if="sessionLoadError" class="empty"><p role="alert">{{ sessionLoadError }}</p><button class="reply-retry" @click="chat.loadSession(sessionId)">重新加载会话</button></div>
        <div v-if="!loadingSession && !sessionLoadError && !messages.length" class="empty">
          <strong>开始一段新对话</strong
          ><span>{{ sessionReady ? "输入问题，或开启知识库引用来获得有依据的回答。" : "点击右上角新建会话，或从左侧选择一段历史对话。" }}</span>
        </div>
        <div
          v-for="message in messages"
          :key="message.id"
          class="message"
          :class="message.role"
        >
          <span class="avatar">{{
            message.role === "user" ? "我" : "AI"
          }}</span>
          <div>
            <p :class="{ typing: streaming && message === messages.at(-1) }">
              {{ message.content }}
            </p>
            <small
              >{{ formatTime(message.createdAt)
              }}<template v-if="message.meta">
                · {{ message.meta }}</template
              ></small
            >
            <button v-if="failedRequests[message.id]" class="reply-retry" :disabled="streaming || !online" @click="retryReply(message.id)">重新生成回复</button>
          </div>
        </div>
      </div>
      <button v-if="!followLatest && messages.length" class="back-to-latest" @click="backToLatest">↓ {{ unseenReply ? '有新内容 · 回到最新消息' : '回到最新消息' }}</button>
      <div v-if="sources.length" class="sources">
        <strong
          >参考资料
          <small>{{
            sourceMode === "vector" ? "语义检索" : "关键词匹配"
          }}</small></strong
        >
        <div
          v-for="(source, index) in sources"
          :key="`${source.documentId}-${source.chunk}`"
        >
          <b>[{{ index + 1 }}] {{ source.title }}</b
          ><span>{{ source.text }}</span>
        </div>
      </div>
      <div class="composer-area">
        <label class="knowledge-toggle"
          ><input v-model="useKnowledge" type="checkbox" /> 参考知识库
          <small>{{ documents.length }} 份资料</small></label
        >
        <div class="composer">
          <textarea
            v-model="prompt"
            rows="2"
            placeholder="输入你的问题…"
            :disabled="!sessionReady || loadingSession"
            @keydown="handleKeydown"
          ></textarea
          ><button
            :class="{ stop: streaming }"
            :aria-label="streaming ? '停止回复' : '发送消息'"
            :disabled="!streaming && (!sessionReady || loadingSession || !online)"
            @click="streaming ? stop() : send()"
          >
            {{ streaming ? "■" : "➤" }}
          </button>
        </div>
        <small>Enter 发送 · Shift + Enter 换行 <span>回答仅供参考</span></small>
      </div>
    </article>
  </section>

  <DeleteSessionDialog
    v-model="deletionOpen"
    :session="sessionToDelete"
    @closed="sessionToDelete = undefined"
  />
</template>
