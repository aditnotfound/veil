import { safeLocalStorage } from "@/lib/storage/helper";
import { STORAGE_KEYS } from "@/config";
import { embedTexts, cosineSimilarity } from "./embed";
import { getAllChunksWithMeta } from "./store";
import type { KnowledgeSettings } from "./types";

const DEFAULT_TOP_K = 7;

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
  return { enabled, focusTags: Array.isArray(focusTags) ? focusTags : [] };
}

export function setKnowledgeEnabled(enabled: boolean) {
  safeLocalStorage.setItem(STORAGE_KEYS.KNOWLEDGE_ENABLED, String(enabled));
}

export function setKnowledgeFocusTags(tags: string[]) {
  safeLocalStorage.setItem(
    STORAGE_KEYS.KNOWLEDGE_FOCUS_TAGS,
    JSON.stringify(tags)
  );
}

export async function retrievePersonalContext(params: {
  query: string;
  apiKey?: string;
  topK?: number;
}): Promise<string> {
  const settings = getKnowledgeSettings();
  if (!settings.enabled) return "";

  const apiKey = params.apiKey?.trim();
  if (!apiKey) return "";

  const query = params.query?.trim();
  if (!query) return "";

  const chunks = await getAllChunksWithMeta();
  if (chunks.length === 0) return "";

  const focus = settings.focusTags.map((t) => t.toLowerCase());
  const filtered =
    focus.length === 0
      ? chunks
      : chunks.filter((c) =>
          c.tags.some((t) => focus.includes(t.toLowerCase()))
        );

  const pool = filtered.length > 0 ? filtered : chunks;
  const [queryEmbedding] = await embedTexts(apiKey, [query]);

  const scored = pool
    .map((c) => ({
      ...c,
      score: cosineSimilarity(queryEmbedding, c.embedding),
    }))
    .filter((c) => c.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, params.topK ?? DEFAULT_TOP_K);

  if (scored.length === 0) return "";

  const blocks = scored.map(
    (c, i) =>
      `[${i + 1}] (from: ${c.title}, relevance: ${c.score.toFixed(2)})\n${c.content}`
  );

  return [
    "## Personal context",
    "Use the following facts about the user when answering. Prefer these over generic assumptions. If irrelevant, ignore quietly.",
    ...blocks,
  ].join("\n\n");
}
