<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import {
  ElTable,
  ElTableColumn,
  ElPagination,
  ElDialog,
  ElButton,
  ElRadioGroup,
  ElRadio,
} from "element-plus";
import "element-plus/es/components/table/style/css";
import "element-plus/es/components/pagination/style/css";
import "element-plus/es/components/dialog/style/css";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/radio/style/css";
import "element-plus/es/components/radio-group/style/css";
import { cleanCallRecords } from "../services/api";
import { useWorkspaceStore } from "../stores/workspace";
import { formatTime, readableStatus } from "../utils/format";
const workspace = useWorkspaceStore();
const { calls } = storeToRefs(workspace);
const cleanupOpen = ref(false),
  cleaning = ref(false),
  cleanupError = ref("");
const cleanupScope = ref<"older7" | "older30" | "all">("older7");
function openCleanup() {
  cleanupScope.value = "older7";
  cleanupError.value = "";
  cleanupOpen.value = true;
}
function closeCleanup(done: () => void) {
  if (!cleaning.value) done();
}
async function confirmCleanup() {
  if (cleaning.value) return;
  cleaning.value = true;
  cleanupError.value = "";
  try {
    const result = await cleanCallRecords(cleanupScope.value);
    cleanupOpen.value = false;
    await workspace.refresh();
    workspace.showNotice(
      result.deleted
        ? `已清理 ${result.deleted} 条调用记录。`
        : "没有需要清理的调用记录。",
    );
  } catch {
    cleanupError.value = "清理失败，请检查服务连接后重试。";
  } finally {
    cleaning.value = false;
  }
}
const currentPage = ref(1),
  pageSize = ref(10);
const rows = computed(() =>
  calls.value.slice(
    (currentPage.value - 1) * pageSize.value,
    currentPage.value * pageSize.value,
  ),
);
watch(pageSize, () => {
  currentPage.value = 1;
});
watch(
  () => calls.value.length,
  (length) => {
    currentPage.value = Math.min(
      currentPage.value,
      Math.max(1, Math.ceil(length / pageSize.value)),
    );
  },
);
</script>
<template>
  <section class="panel calls-panel">
    <div class="title calls-heading">
      <div>
        <b>调用记录</b><small>自动保留最近 30 天 · 每小时清理过期记录</small>
      </div>
      <ElButton class="cleanup-trigger" @click="openCleanup"
        ><svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg
        ><span>清理记录</span></ElButton
      >
    </div>
    <ElTable
      :data="rows"
      class="calls-table"
      empty-text="暂无调用记录，开始对话后可在这里查看。"
      table-layout="auto"
    >
      <ElTableColumn
        prop="traceId"
        label="请求编号"
        min-width="160"
        show-overflow-tooltip
      />
      <ElTableColumn prop="model" label="模型" min-width="120" />
      <ElTableColumn label="状态" min-width="100"
        ><template #default="{ row }"
          ><span class="call-status" :class="row.status">{{
            readableStatus(row.status)
          }}</span></template
        ></ElTableColumn
      >
      <ElTableColumn label="首字时间" min-width="110"
        ><template #default="{ row }">{{
          row.firstTokenMs == null ? "—" : `${row.firstTokenMs} ms`
        }}</template></ElTableColumn
      >
      <ElTableColumn label="总耗时" min-width="100"
        ><template #default="{ row }"
          >{{ (row.durationMs / 1000).toFixed(2) }} s</template
        ></ElTableColumn
      >
      <ElTableColumn prop="outputChars" label="输出字数" min-width="100" />
      <ElTableColumn label="时间" min-width="130"
        ><template #default="{ row }">{{
          formatTime(row.createdAt)
        }}</template></ElTableColumn
      >
      <ElTableColumn
        prop="error"
        label="异常信息"
        min-width="140"
        show-overflow-tooltip
        ><template #default="{ row }">{{
          row.error || "—"
        }}</template></ElTableColumn
      >
    </ElTable>
    <ElPagination
      v-if="calls.length"
      v-model:current-page="currentPage"
      v-model:page-size="pageSize"
      :page-sizes="[10, 20, 50]"
      :total="calls.length"
      layout="total, sizes, prev, pager, next"
      class="calls-pagination"
    />
  </section>
  <ElDialog
    v-model="cleanupOpen"
    title="清理调用记录"
    class="call-cleanup-dialog"
    width="min(460px, calc(100vw - 32px))"
    align-center
    :show-close="!cleaning"
    :before-close="closeCleanup"
    :close-on-click-modal="false"
    :close-on-press-escape="!cleaning"
  >
    <p class="cleanup-description">
      选择需要清理的记录范围。会话、聊天内容及知识库将保留。
    </p>
    <ElRadioGroup
      v-model="cleanupScope"
      class="cleanup-options"
      :disabled="cleaning"
      aria-label="清理范围"
    >
      <ElRadio value="older7" border>清理 7 天前的记录</ElRadio>
      <ElRadio value="older30" border>清理 30 天前的记录</ElRadio>
      <ElRadio value="all" border>清理全部已有记录</ElRadio>
    </ElRadioGroup>
    <p class="cleanup-warning">
      清理后无法恢复，对应时间段的首页统计也会随之更新。
    </p>
    <p v-if="cleanupError" class="error" role="alert">{{ cleanupError }}</p>
    <template #footer
      ><ElButton :disabled="cleaning" @click="cleanupOpen = false"
        >取消</ElButton
      ><ElButton
        class="cleanup-confirm"
        :disabled="cleaning"
        :loading="cleaning"
        @click="confirmCleanup"
        >{{ cleaning ? "正在清理…" : "确认清理" }}</ElButton
      ></template
    >
  </ElDialog>
</template>
