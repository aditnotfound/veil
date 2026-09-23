import { getDatabase } from "@/lib/database";
import { invoke } from "@tauri-apps/api/core";
import type { KnowledgeSource, KnowledgeSourceKind } from "./types";
import { chunkText } from "./chunk";
import { embedTexts } from "./embed";

function newId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function listKnowledgeSources(): Promise<KnowledgeSource[]> {
  const db = await getDatabase();
  const rows = await db.select<
    {
      id: string;
      title: string;
      kind: KnowledgeSourceKind;
      tags: string;
      raw_text: string;
      created_at: number;
      updated_at: number;
    }[]
  >("SELECT * FROM knowledge_sources ORDER BY updated_at DESC");

  return rows.map((r) => ({
    ...r,
    tags: parseTags(r.tags),
  }));
}

export async function deleteKnowledgeSource(id: string): Promise<void> {
  await getDatabase(); // Ensure migrations completed before the native transaction.
  await invoke("delete_knowledge_index", { sourceId: id });
}

export async function ingestKnowledgeSource(params: {
  title: string;
  kind: KnowledgeSourceKind;
  text: string;
  tags: string[];
  apiKey?: string;
  existingId?: string;
}): Promise<string> {
  const { title, kind, text, tags, apiKey, existingId } = params;
  const cleaned = text.trim();
  if (!cleaned) throw new Error("Nothing to ingest — empty text");

  const now = Date.now();
  const id = existingId || newId("ks");
  const chunks = chunkText(cleaned);
  const prepared: { id: string; content: string; embedding: number[] }[] = [];

  // Prepare every network result before changing any stored source or index.
  const batchSize = 32;
  for (let i = 0; i < chunks.length && apiKey?.trim(); i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const embeddings = await embedTexts(apiKey, batch);
    if (embeddings.length !== batch.length || embeddings.some(
      (vector) => !Array.isArray(vector) || vector.length === 0 ||
        vector.some((number) => !Number.isFinite(number))
    )) {
      throw new Error("Embedding provider returned incomplete vectors; the old index was preserved.");
    }
    for (let j = 0; j < batch.length; j++) {
      prepared.push({ id: newId("kc"), content: batch[j], embedding: embeddings[j] });
    }
  }

  if (!apiKey?.trim()) {
    prepared.push(...chunks.map((content) => ({ id: newId("kc"), content, embedding: [] })));
  }

  await getDatabase(); // Ensure migrations completed before the native transaction.
  await invoke("commit_knowledge_index", {
    input: {
      sourceId: id,
      replace: !!existingId,
      title,
      kind,
      tags,
      rawText: cleaned,
      updatedAt: now,
      chunks: prepared,
    },
  });
  return id;
}

export async function getAllChunksWithMeta(): Promise<
  {
    id: string;
    source_id: string;
    content: string;
    embedding: number[];
    tags: string[];
    title: string;
  }[]
> {
  const db = await getDatabase();
  const rows = await db.select<
    {
      id: string;
      source_id: string;
      content: string;
      embedding: string;
      tags: string;
      title: string;
    }[]
  >(
    `SELECT c.id, c.source_id, c.content, c.embedding, s.tags, s.title
     FROM knowledge_chunks c
     JOIN knowledge_sources s ON s.id = c.source_id`
  );

  return rows.map((r) => ({
    id: r.id,
    source_id: r.source_id,
    content: r.content,
    embedding: (() => {
      try {
        return JSON.parse(r.embedding) as number[];
      } catch {
        return [];
      }
    })(),
    tags: parseTags(r.tags),
    title: r.title,
  }));
}
