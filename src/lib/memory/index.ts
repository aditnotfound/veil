import { invoke } from "@tauri-apps/api/core";
import { getDatabase } from "@/lib/database/config";
import type { MemoryInput, MemoryItem, RecallHit } from "./format";

export * from "./format";

export interface RecallStatus {
  modelReady: boolean;
  modelLoading: boolean;
  indexing: boolean;
  items: number;
}

export const MEMORY_FROM_CALLS_KEY = "memory_from_calls_enabled";

export function notifyMemoryChanged() {
  window.dispatchEvent(new Event("memory-changed"));
}

let warmup: Promise<RecallStatus> | null = null;
/** Loads the recall index once per window; later calls reuse the same promise. */
export function warmRecall(): Promise<RecallStatus> {
  warmup ??= getDatabase()
    .then(() => invoke<RecallStatus>("recall_warmup"))
    .catch((error) => { warmup = null; throw error; });
  return warmup;
}

export function recallStatus(): Promise<RecallStatus> {
  return invoke<RecallStatus>("recall_status");
}

export async function recall(query: string, limit = 8, minRelevance?: number): Promise<RecallHit[]> {
  if (!query.trim()) return [];
  return invoke<RecallHit[]>("recall_search", { query, limit, minRelevance });
}

type MemoryRow = Omit<MemoryItem, "enabled"> & { enabled: number };

export async function listMemories(): Promise<MemoryItem[]> {
  const db = await getDatabase();
  const rows = await db.select<MemoryRow[]>(
    "SELECT * FROM memory_items ORDER BY CASE layer WHEN 'core' THEN 0 WHEN 'shared' THEN 1 ELSE 2 END, updated_at DESC"
  );
  return rows.map((row) => ({ ...row, enabled: row.enabled === 1 }));
}

export async function loadCoreMemories(): Promise<MemoryItem[]> {
  const db = await getDatabase();
  const rows = await db.select<MemoryRow[]>(
    "SELECT * FROM memory_items WHERE layer = 'core' AND enabled = 1 ORDER BY updated_at DESC LIMIT 40"
  );
  return rows.map((row) => ({ ...row, enabled: true }));
}

export async function saveMemories(items: MemoryInput[], dedupe = true): Promise<{ id: string; merged: boolean }[]> {
  if (!items.length) return [];
  const saved = await invoke<{ id: string; merged: boolean }[]>("memory_save", { items, dedupe });
  notifyMemoryChanged();
  return saved;
}

export async function deleteMemories(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await invoke("memory_delete", { ids });
  notifyMemoryChanged();
}

export function memoryFromCallsEnabled(): boolean {
  return localStorage.getItem(MEMORY_FROM_CALLS_KEY) !== "false";
}
