import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenAIEmbeddings } from "@langchain/openai";
import { config } from "./config.js";

export interface Passage {
  documentId: string;
  title: string;
  chunk: number;
  text: string;
  score: number;
}
interface Chunk {
  text: string;
  vector?: number[];
}
interface KnowledgeDocument {
  id: string;
  title: string;
  createdAt: string;
  chars: number;
  chunks: Chunk[];
  embeddingSource?: string;
}
const file = path.join(
  process.env.APP_DATA_DIR ||
    fileURLToPath(new URL("../data/", import.meta.url)),
  "knowledge.json",
);
let documents: KnowledgeDocument[] | undefined;
let writeQueue = Promise.resolve();

async function load() {
  if (documents) return documents;
  try {
    documents = JSON.parse(
      await fs.readFile(file, "utf8"),
    ) as KnowledgeDocument[];
  } catch {
    documents = [];
  }
  return documents;
}
async function save() {
  const data = await load();
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await fs.writeFile(temp, JSON.stringify(data));
    await fs.rename(temp, file);
  });
  await writeQueue;
}
function splitText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  const chunks: string[] = [];
  for (let start = 0; start < clean.length; start += 600)
    chunks.push(clean.slice(start, start + 700));
  return chunks;
}
const embeddingSource = () =>
  `${config.embeddingBaseUrl.replace(/\/$/, "")}/${config.embeddingModel}`;
function embeddings() {
  return new OpenAIEmbeddings({
    apiKey: config.embeddingKey,
    model: config.embeddingModel,
    timeout: 30_000,
    configuration: { baseURL: config.embeddingBaseUrl },
  });
}
function validateVectors(vectors: number[][], expected: number) {
  const dimensions = vectors[0]?.length;
  if (
    vectors.length !== expected ||
    !dimensions ||
    vectors.some(
      (vector) =>
        vector.length !== dimensions ||
        vector.some((value) => !Number.isFinite(value)) ||
        !vector.some((value) => value !== 0),
    )
  ) {
    throw new Error("向量服务返回了无效数据，资料未建立索引");
  }
}
function cosine(a: number[], b: number[]) {
  if (a.length !== b.length) return 0;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] ** 2;
    bb += b[i] ** 2;
  }
  return dot / (Math.sqrt(aa) * Math.sqrt(bb) || 1);
}
function lexicalScore(query: string, text: string) {
  const terms =
    query.toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]{3,}/gu) || [];
  const words = [
    ...new Set(
      terms.flatMap((term) =>
        /[\p{Script=Han}]/u.test(term)
          ? Array.from({ length: Math.max(0, term.length - 1) }, (_, i) =>
              term.slice(i, i + 2),
            )
          : [term],
      ),
    ),
  ];
  const lower = text.toLowerCase();
  return words.reduce(
    (total, word) => total + (lower.includes(word) ? 1 : 0),
    0,
  );
}

export async function listDocuments() {
  return (await load()).map(
    ({ id, title, createdAt, chars, chunks, embeddingSource: source }) => ({
      id,
      title,
      createdAt,
      chars,
      chunkCount: chunks.length,
      indexed: Boolean(
        config.embeddingKey &&
        source === embeddingSource() &&
        chunks.every((c) => Boolean(c.vector?.length)),
      ),
    }),
  );
}
export async function addDocument(title: string, text: string) {
  const data = await load();
  if (data.length >= 50) throw new Error("知识库最多保存 50 份文档");
  const chunks = splitText(text).map((value) => ({ text: value }) as Chunk);
  if (config.embeddingKey) {
    const vectors = await embeddings().embedDocuments(
      chunks.map((c) => c.text),
    );
    validateVectors(vectors, chunks.length);
    vectors.forEach((vector, index) => {
      chunks[index].vector = vector;
    });
  }
  const doc = {
    id: crypto.randomUUID(),
    title,
    createdAt: new Date().toISOString(),
    chars: text.length,
    chunks,
    embeddingSource: config.embeddingKey ? embeddingSource() : undefined,
  };
  data.unshift(doc);
  await save();
  return {
    id: doc.id,
    title: doc.title,
    createdAt: doc.createdAt,
    chars: doc.chars,
    chunkCount: chunks.length,
    indexed: Boolean(config.embeddingKey),
  };
}
export async function deleteDocument(id: string) {
  const data = await load();
  const index = data.findIndex((d) => d.id === id);
  if (index < 0) return false;
  data.splice(index, 1);
  await save();
  return true;
}
export async function searchKnowledge(
  query: string,
  limit = 4,
): Promise<{ mode: "vector" | "keyword"; passages: Passage[] }> {
  const docs = await load();
  if (
    config.embeddingKey &&
    docs.some(
      (d) =>
        d.embeddingSource !== embeddingSource() ||
        d.chunks.some((c) => !c.vector?.length),
    )
  ) {
    const outdated = docs.filter(
      (d) =>
        d.embeddingSource !== embeddingSource() ||
        d.chunks.some((c) => !c.vector?.length),
    );
    const chunks = outdated.flatMap((d) => d.chunks);
    const vectors = await embeddings().embedDocuments(
      chunks.map((c) => c.text),
    );
    validateVectors(vectors, chunks.length);
    vectors.forEach((vector, index) => {
      chunks[index].vector = vector;
    });
    outdated.forEach((d) => {
      d.embeddingSource = embeddingSource();
    });
    await save();
  }
  const canVector = Boolean(
    config.embeddingKey &&
    docs.some(
      (d) =>
        d.embeddingSource === embeddingSource() &&
        d.chunks.some((c) => c.vector?.length),
    ),
  );
  const queryVector = canVector ? await embeddings().embedQuery(query) : null;
  if (queryVector) validateVectors([queryVector], 1);
  const passages = docs
    .flatMap((d) =>
      d.chunks.map((c, index) => ({
        documentId: d.id,
        title: d.title,
        chunk: index + 1,
        text: c.text,
        score:
          queryVector && c.vector
            ? cosine(queryVector, c.vector)
            : lexicalScore(query, c.text),
      })),
    )
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { mode: canVector ? "vector" : "keyword", passages };
}
