import { getDatabase } from "@/lib/database";
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
  const db = await getDatabase();
  await db.execute("DELETE FROM knowledge_chunks WHERE source_id = $1", [id]);
  await db.execute("DELETE FROM knowledge_sources WHERE id = $1", [id]);
}

export async function ingestKnowledgeSource(params: {
  title: string;
  kind: KnowledgeSourceKind;
  text: string;
  tags: string[];
  apiKey: string;
  existingId?: string;
}): Promise<string> {
  const { title, kind, text, tags, apiKey, existingId } = params;
  const cleaned = text.trim();
  if (!cleaned) throw new Error("Nothing to ingest — empty text");

  const db = await getDatabase();
  const now = Date.now();
  const id = existingId || newId("ks");

  if (existingId) {
    await db.execute("DELETE FROM knowledge_chunks WHERE source_id = $1", [
      existingId,
    ]);
    await db.execute(
      `UPDATE knowledge_sources
       SET title = $1, kind = $2, tags = $3, raw_text = $4, updated_at = $5
       WHERE id = $6`,
      [title, kind, JSON.stringify(tags), cleaned, now, existingId]
    );
  } else {
    await db.execute(
      `INSERT INTO knowledge_sources (id, title, kind, tags, raw_text, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, title, kind, JSON.stringify(tags), cleaned, now, now]
    );
  }

  const chunks = chunkText(cleaned);
  // Batch embeddings (OpenAI allows arrays)
  const batchSize = 32;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const embeddings = await embedTexts(apiKey, batch);
    for (let j = 0; j < batch.length; j++) {
      const chunkId = newId("kc");
      await db.execute(
        `INSERT INTO knowledge_chunks (id, source_id, chunk_index, content, embedding, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          chunkId,
          id,
          i + j,
          batch[j],
          JSON.stringify(embeddings[j] || []),
          now,
        ]
      );
    }
  }

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
