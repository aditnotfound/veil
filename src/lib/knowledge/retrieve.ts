import { safeLocalStorage } from "@/lib/storage/helper";
import { STORAGE_KEYS } from "@/config";
import type { KnowledgeSettings } from "./types";
import { getDatabase } from "@/lib/database/config";
import { buildFtsQuery } from "@/lib/call/local-search";
import { formatKnowledgeExcerpts, LOCAL_KNOWLEDGE_SQL, PINNED_KNOWLEDGE_SQL, selectKnowledgeExcerpts, type KnowledgeExcerpt } from "./preparation";
import { formatCoreMemories, formatMemoryHits, loadCoreMemories, recall, type RecallHit } from "@/lib/memory";

const DEFAULT_TOP_K = 7;
const RECALL_CANDIDATES = 12;
const MAX_MEMORY_HITS = 4;

function chunkExcerpt(hit: RecallHit): KnowledgeExcerpt {
  return {
    id: hit.id, source_id: hit.sourceId, title: hit.title, content: hit.text,
    tags: hit.tags, updated_at: hit.updatedAt, pinned: Number(hit.pinned),
  };
}

/** Keyword-only search, used when the native recall engine is unavailable. */
async function keywordMatches(query: string): Promise<KnowledgeExcerpt[]> {
  const match = buildFtsQuery(query);
  if (!match) return [];
  const db = await getDatabase();
  return db.select<KnowledgeExcerpt[]>(LOCAL_KNOWLEDGE_SQL, [match]);
}

/**
 * Local, network-free recall for live calls and Ask: core memory, pinned
 * references, and hybrid (keyword + on-device semantic) matches across the
 * library and saved memories.
 */
export async function retrievePersonalContextLocal(params: {
  query: string;
  topK?: number;
  includePinned?: boolean;
}): Promise<string> {
  const settings = getKnowledgeSettings();
  if (!settings.enabled) return "";
  const query = params.query?.trim() ?? "";
  const db = await getDatabase();
  const [hits, pinned, core] = await Promise.all([
    query ? recall(query, RECALL_CANDIDATES).catch(async (error) => {
      console.warn("Native recall unavailable, using keyword search:", error);
      return (await keywordMatches(query)).map((row): RecallHit => ({
        id: row.id, kind: "chunk", sourceId: row.source_id, title: row.title, text: row.content,
        layer: null, memoryKind: null, origin: null, tags: row.tags, updatedAt: row.updated_at,
        pinned: Boolean(row.pinned), score: 0, similarity: null, relevance: null, lexical: true,
      }));
    }) : Promise.resolve([]),
    params.includePinned === false ? Promise.resolve([]) : db.select<KnowledgeExcerpt[]>(PINNED_KNOWLEDGE_SQL),
    loadCoreMemories().catch(() => []),
  ]);
  const coreIds = new Set(core.map(({ id }) => id));
  const memories = hits.filter((hit) => hit.kind === "memory" && !coreIds.has(hit.id)).slice(0, MAX_MEMORY_HITS);
  const chunks = hits.filter((hit) => hit.kind === "chunk").map(chunkExcerpt);
  return [
    formatCoreMemories(core),
    formatMemoryHits(memories),
    formatKnowledgeExcerpts(selectKnowledgeExcerpts(pinned, chunks, settings.focusTags, params.topK ?? DEFAULT_TOP_K)),
  ].filter(Boolean).join("\n\n");
}

export function getKnowledgeSettings(): KnowledgeSettings {
  const enabled =
    safeLocalStorage.getItem(STORAGE_KEYS.KNOWLEDGE_ENABLED) !== "false";
  let focusTags: string[] = [];
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEYS.KNOWLEDGE_FOCUS_TAGS);
    if (raw) focusTags = JSON.parse(raw);
  } catch {
    focusTags = [];
  }
  return { enabled, focusTags: Array.isArray(focusTags) ? focusTags.filter((tag) => typeof tag === "string") : [] };
}

export function setKnowledgeEnabled(enabled: boolean) {
  safeLocalStorage.setItem(STORAGE_KEYS.KNOWLEDGE_ENABLED, String(enabled));
  window.dispatchEvent(new Event("knowledge-changed"));
}

export function setKnowledgeFocusTags(tags: string[]) {
  safeLocalStorage.setItem(
    STORAGE_KEYS.KNOWLEDGE_FOCUS_TAGS,
    JSON.stringify(tags)
  );
  window.dispatchEvent(new Event("knowledge-changed"));
}

/** Ask uses the same on-device recall as live calls; no embedding request leaves the device. */
export async function retrievePersonalContext(params: {
  query: string;
  apiKey?: string;
  topK?: number;
}): Promise<string> {
  return retrievePersonalContextLocal({ query: params.query, topK: params.topK });
}
