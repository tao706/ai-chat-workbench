<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { addDocument, deleteDocument } from "../services/api";
import { useWorkspaceStore } from "../stores/workspace";
import { formatTime } from "../utils/format";
const workspace = useWorkspaceStore();
const { documents, error } = storeToRefs(workspace);
const { refresh, showNotice } = workspace;
const docTitle = ref(""),
  docText = ref(""),
  uploading = ref(false),
  deleteConfirmId = ref("");
async function chooseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 100_000) {
    error.value = "文档不能超过 100 KB";
    return;
  }
  docTitle.value = file.name;
  docText.value = await file.text();
}
async function uploadDocument() {
  if (
    !docTitle.value.trim() ||
    docText.value.trim().length < 20 ||
    uploading.value
  )
    return;
  uploading.value = true;
  error.value = "";
  try {
    await addDocument(docTitle.value.trim(), docText.value.trim());
    docTitle.value = "";
    docText.value = "";
    await refresh();
    showNotice("资料已加入知识库");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "保存资料失败";
  } finally {
    uploading.value = false;
  }
}
async function removeDocument(id: string) {
  if (deleteConfirmId.value !== id) {
    deleteConfirmId.value = id;
    return;
  }
  try {
    await deleteDocument(id);
    deleteConfirmId.value = "";
    await refresh();
    showNotice("资料已删除");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "删除资料失败";
  }
}
</script>
<template>
  <section class="knowledge-layout">
    <article class="panel knowledge-form">
      <div class="title">
        <b>添加资料</b><small>支持 TXT / Markdown，最大 100 KB</small>
      </div>
      <label class="upload-box"
        >选择本地文档<input
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          @change="chooseFile" /></label
      ><input
        v-model="docTitle"
        class="field"
        maxlength="120"
        placeholder="资料名称"
      /><textarea
        v-model="docText"
        class="field doc-editor"
        maxlength="100000"
        placeholder="也可以直接粘贴资料内容，至少 20 字"
      ></textarea
      ><button
        class="primary"
        :disabled="uploading || !docTitle.trim() || docText.trim().length < 20"
        @click="uploadDocument"
      >
        {{ uploading ? "正在处理…" : "保存到知识库" }}
      </button>
      <p class="hint">
        开启会话中的“参考知识库”后，回答会展示匹配资料及来源。未配置向量检索时使用关键词匹配。
      </p>
    </article>
    <article class="panel knowledge-list">
      <div class="title">
        <b>已保存资料</b><small>{{ documents.length }} 份</small>
      </div>
      <div v-if="!documents.length" class="empty-block">
        暂无资料。添加业务说明、产品手册或常见问题，开始构建知识库。
      </div>
      <div v-for="doc in documents" :key="doc.id" class="doc-row">
        <div class="doc-icon">▧</div>
        <div>
          <strong>{{ doc.title }}</strong><small
            >{{ doc.chunkCount }} 段 · {{ doc.chars }} 字 ·
            {{ formatTime(doc.createdAt) }}</small
          ><small>{{
            doc.indexed ? "已建立语义索引" : "关键词匹配模式"
          }}</small>
        </div>
        <button class="text-button danger" @click="removeDocument(doc.id)">
          {{ deleteConfirmId === doc.id ? "再次点击确认" : "删除" }}
        </button>
      </div>
    </article>
  </section>
</template>
