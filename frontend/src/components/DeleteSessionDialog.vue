<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElDialog, ElButton } from "element-plus";
import "element-plus/es/components/dialog/style/css";
import "element-plus/es/components/button/style/css";
import { useChatStore } from "../stores/chat";
import type { Session } from "../types";
const props = defineProps<{ modelValue: boolean; session?: Session }>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  closed: [];
}>();
const chat = useChatStore(),
  deleting = ref(false),
  error = ref("");
const cancelButton = ref<InstanceType<typeof ElButton>>();
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => {
    if (!deleting.value) emit("update:modelValue", value);
  },
});
watch(
  () => props.modelValue,
  (value) => {
    if (value) error.value = "";
  },
);
async function confirm() {
  if (deleting.value || !props.session) return;
  deleting.value = true;
  error.value = "";
  try {
    await chat.deleteConversation(props.session.sessionId);
    emit("update:modelValue", false);
  } catch (cause: any) {
    error.value = cause?.response?.data?.error || "删除失败，请稍后重试。";
  } finally {
    deleting.value = false;
  }
}
</script>
<template>
  <ElDialog
    v-model="visible"
    title="删除这段会话？"
    class="session-delete-dialog"
    modal-class="session-delete-overlay"
    width="min(440px, calc(100vw - 32px))"
    align-center
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="!deleting"
    @opened="cancelButton?.$el.focus()"
    @closed="emit('closed')"
  >
    <div class="delete-dialog-top">
      <div class="delete-dialog-symbol" aria-hidden="true">
        <svg
          width="27"
          height="27"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
        </svg>
      </div>
      <button
        class="delete-dialog-close"
        aria-label="关闭删除确认"
        :disabled="deleting"
        @click="visible = false"
      >
        ×
      </button>
    </div>
    <span class="delete-dialog-label">会话管理</span>
    <h2>删除这段会话？</h2>
    <p>删除后，这段会话及其中的聊天消息将无法恢复。</p>
    <div class="delete-dialog-target">
      <span aria-hidden="true">▤</span><strong>{{ session?.title }}</strong>
    </div>
    <p v-if="error" class="delete-dialog-error" role="alert">{{ error }}</p>
    <div class="delete-dialog-actions">
      <ElButton
        ref="cancelButton"
        class="delete-cancel"
        :disabled="deleting"
        @click="visible = false"
        >保留会话</ElButton
      ><ElButton
        class="delete-confirm"
        :loading="deleting"
        :disabled="deleting"
        @click="confirm"
        >{{ deleting ? "正在删除…" : "确认删除" }}</ElButton
      >
    </div>
  </ElDialog>
</template>
