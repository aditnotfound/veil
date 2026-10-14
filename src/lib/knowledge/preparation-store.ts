import { getDatabase } from "@/lib/database/config";
import { getKnowledgeSettings } from "./retrieve";
import { EMPTY_PREPARATION, formatPreparation, normalizePreparation, type KnowledgePreparation } from "./preparation";

export function notifyKnowledgeChanged() {
  try { localStorage.setItem("veil_knowledge_revision", String(Date.now())); } catch { /* SQLite save already succeeded. */ }
  window.dispatchEvent(new Event("knowledge-changed"));
}

export async function loadPreparation(): Promise<KnowledgePreparation> {
  const db = await getDatabase();
  const rows = await db.select<{ preparation_json: string }[]>("SELECT preparation_json FROM knowledge_preparation WHERE id = 1");
  if (!rows.length) return { ...EMPTY_PREPARATION };
  return normalizePreparation(JSON.parse(rows[0].preparation_json));
}

export async function savePreparation(value: KnowledgePreparation): Promise<KnowledgePreparation> {
  const prep = normalizePreparation({ ...value, updatedAt: Date.now() });
  const db = await getDatabase();
  await db.execute(`INSERT INTO knowledge_preparation (id, preparation_json, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET preparation_json=excluded.preparation_json, updated_at=excluded.updated_at`,
    [JSON.stringify(prep), prep.updatedAt]);
  notifyKnowledgeChanged();
  return prep;
}

export async function captureSessionPreparation(sessionId: string): Promise<string> {
  const context = getKnowledgeSettings().enabled ? formatPreparation(await loadPreparation()) : "";
  const db = await getDatabase();
  await db.execute("INSERT INTO call_session_context (session_id, context_text, created_at) VALUES (?, ?, ?)",
    [sessionId, context, Date.now()]);
  return context;
}

export async function getSessionPreparation(sessionId: string): Promise<string> {
  const db = await getDatabase();
  const rows = await db.select<{ context_text: string }[]>("SELECT context_text FROM call_session_context WHERE session_id = ?", [sessionId]);
  return rows[0]?.context_text ?? "";
}
