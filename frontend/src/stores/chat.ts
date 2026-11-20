import { router } from "../router";
import { RequestFailure, failureMessage } from "../services/errors";
import { computed, reactive, ref, shallowRef } from "vue";
import { defineStore, storeToRefs } from "pinia";
import {
  createSession,
  getSession,
  deleteSession,
  renameSession,
  streamChat,
} from "../services/api";
import { useWorkspaceStore } from "./workspace";
import type { ChatMessage, Source, StreamMeta } from "../types";
export const useChatStore = defineStore("chat", () => {
  const workspace = useWorkspaceStore();
  const { sessions, error } = storeToRefs(workspace);
  const { refresh } = workspace;
  const sessionId = ref(`session_${crypto.randomUUID()}`),
    messages = ref<ChatMessage[]>([]),
    prompt = ref("");
  const streaming = ref(false),
    controller = shallowRef<AbortController>(),
    streamMeta = ref<StreamMeta>();
  const sources = ref<Source[]>([]),
    sourceMode = ref<"vector" | "keyword">("keyword"),
    useKnowledge = ref(false);
  const failedRequests=ref<Record<string,{question:string;sessionId:string;useKnowledge:boolean;userId:string}>>({});
  async function retryReply(id:string) {
    const failed=failedRequests.value[id];
    if(!failed || streaming.value || !workspace.online || failed.sessionId!==sessionId.value) return;
    messages.value=messages.value.filter(message=>message.id!==id && message.id!==failed.userId);
    delete failedRequests.value[id];
    prompt.value=failed.question; useKnowledge.value=failed.useKnowledge;
    await send();
  }
  const loadingSession=ref(false), sessionReady=ref(false), sessionLoadError=ref("");
  let loadVersion=0, streamVersion=0;
  const scrollVersion = ref(0);
  const currentSession = computed(() =>
    sessions.value.find((s) => s.sessionId === sessionId.value),
  );
  async function scrollBottom() {
    scrollVersion.value++;
  }
  function stop() {
    controller.value?.abort();
  }
  function resetConversation() {
    streamVersion++; stop(); controller.value=undefined; streaming.value=false;
    sessionReady.value=false; messages.value=[]; sources.value=[]; streamMeta.value=undefined;
    failedRequests.value={}; prompt.value="";
  }
  async function loadSession(id?:string) {
    if(id && id===sessionId.value && sessionReady.value) return;
    const version=++loadVersion;
    resetConversation(); loadingSession.value=!!id; sessionLoadError.value="";
    sessionId.value=id || `session_${crypto.randomUUID()}`;
    if(!id) return;
    if(!/^session_[a-zA-Z0-9-]{8,64}$/.test(id)){sessionLoadError.value="会话地址无效，请从左侧选择会话或新建会话。";loadingSession.value=false;return;}
    try {
      const value=await getSession(id);
      if(version!==loadVersion) return;
      messages.value=value.messages; sessionReady.value=true;
      if(!sessions.value.some(item=>item.sessionId===id)) sessions.value.unshift(value);
      await scrollBottom();
    } catch(cause) {
      if(version===loadVersion) sessionLoadError.value=failureMessage(cause);
    } finally {if(version===loadVersion) loadingSession.value=false;}
  }
  async function startSession() {
    const id=`session_${crypto.randomUUID()}`;
    try {
      await createSession(id);
      await router.push({name:"sessions",params:{sessionId:id}});
      await refresh();
    } catch(cause) {error.value=failureMessage(cause);}
  }
  async function openSession(id:string) {
    await router.push({name:"sessions",params:{sessionId:id}});
  }
  function leaveConversation() {sessionReady.value=false;loadVersion++; loadingSession.value=false; streamVersion++; stop(); streaming.value=false;controller.value=undefined;}
  async function send() {
    const text = prompt.value.trim();
    if (!text || streaming.value || loadingSession.value || sessionLoadError.value) return;
    if(!sessionReady.value) {
      error.value="请先新建或选择一个会话。";
      return;
    }
    if(!workspace.online){error.value="网络已断开，请恢复联网后再发送。";return;}
    error.value = "";
    prompt.value = "";
    streaming.value = true;
    sources.value = [];
    controller.value = new AbortController();
    const currentId = sessionId.value, version=++streamVersion;
    const userId=crypto.randomUUID(), requestUseKnowledge=useKnowledge.value;
    messages.value.push({
      id: userId,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    });
    const assistant = reactive<ChatMessage>({
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      meta: "正在回复",
    });
    messages.value.push(assistant);
    await scrollBottom();
    const signal = controller.value.signal;
    const pending: string[] = [];
    let cursor = 0;
    let receivedChars = 0;
    let characterBudget = 0;
    let lastFrame = performance.now();
    let completedMeta = "";
    let finishDisplay: (() => void) | undefined;
    let cancelDisplay: ((reason: DOMException) => void) | undefined;
    const abortDisplay = () => {
      window.clearInterval(displayTimer);
      pending.length = 0;
      cancelDisplay?.(new DOMException("回复展示已停止", "AbortError"));
    };
    const displayTimer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = Math.min(100, now - lastFrame);
      lastFrame = now;
      if (signal.aborted) return;
      const remaining = pending.length - cursor;
      if (remaining > 0) {
        const baseRate =
          receivedChars <= 160
            ? 35
            : receivedChars <= 500
              ? 65
              : receivedChars <= 1500
                ? 120
                : 200;
        const catchUpRate =
          receivedChars > 160 ? Math.min(400, remaining / 2) : 0;
        characterBudget += (elapsed * Math.max(baseRate, catchUpRate)) / 1000;
        const count = Math.min(remaining, Math.floor(characterBudget));
        if (count > 0) {
          assistant.content += pending.slice(cursor, cursor + count).join("");
          cursor += count;
          characterBudget -= count;
          void scrollBottom();
        }
      }
      if (cursor === pending.length) {
        pending.length = 0;
        cursor = 0;
        characterBudget = 0;
        finishDisplay?.();
      }
    }, 16);
    signal.addEventListener("abort", abortDisplay, { once: true });
    try {
      await streamChat(
        text,
        currentId,
        requestUseKnowledge,
        controller.value.signal,
        {
          onMeta(value) {
            if(version===streamVersion) streamMeta.value = value;
          },
          onSources(value) {
            if(version!==streamVersion)return;
            sources.value = value.passages;
            sourceMode.value = value.mode;
          },
          onToken(token) {
            const characters = Array.from(token);
            receivedChars += characters.length;
            pending.push(...characters);
          },
          onDone(value) {
            completedMeta = `${value.durationMs} ms · 首字 ${value.firstTokenMs ?? "—"} ms`;
          },
        },
      );
      if (signal.aborted)
        throw new DOMException("回复展示已停止", "AbortError");
      if (cursor < pending.length)
        await new Promise<void>((resolve, reject) => {
          finishDisplay = resolve;
          cancelDisplay = reject;
        });
      if(version!==streamVersion)return;
      assistant.meta = completedMeta;
      await refresh();
    } catch (cause) {
      if(version!==streamVersion)return;
      if ((cause as Error).name === "AbortError") {
        assistant.content ||= "回复已停止。";
        assistant.meta = completedMeta
          ? "已停止显示 · 完整回复已保存"
          : "已停止 · 未保存";
      } else {
        error.value = failureMessage(cause);
        if(!(cause instanceof RequestFailure) || cause.retryable) failedRequests.value[assistant.id]={question:text,sessionId:currentId,useKnowledge:requestUseKnowledge,userId};
        assistant.content ||= "回复中断，请检查连接后重试。";
        assistant.meta = "失败 · 未保存";
      }
      if (!prompt.value.trim()) prompt.value = text;
    } finally {
      window.clearInterval(displayTimer);
      signal.removeEventListener("abort", abortDisplay);
      pending.length = 0;
      if(version===streamVersion){streaming.value = false; controller.value = undefined;}
      await refresh();
    }
  }

  async function renameConversation(id: string, title: string) {
    await renameSession(id, title);
    await refresh();
  }
  async function deleteConversation(id: string) {
    await deleteSession(id);
    if (sessionId.value === id) {
      stop();
      sessionId.value = `session_${crypto.randomUUID()}`;
      messages.value = [];
      sources.value = [];
      streamMeta.value = undefined;
      sessionReady.value=false;
      await router.replace({name:"sessions",params:{}});
    }
    sessions.value = sessions.value.filter((item) => item.sessionId !== id);
    workspace.showNotice("会话已删除");
    await refresh();
  }
  return {
    loadingSession, sessionReady, sessionLoadError, loadSession, leaveConversation,
    sessionId,
    messages,
    prompt,
    streaming,
    streamMeta,
    sources,
    sourceMode,
    useKnowledge,
    currentSession,
    scrollVersion,
    failedRequests, retryReply,
    startSession,
    openSession,
    send,
    stop,
    renameConversation,
    deleteConversation,
  };
});
