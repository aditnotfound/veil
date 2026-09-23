import { getDatabase } from "./config";
import type { FinalUtterance } from "../call/session-core";
import { deriveSessionLedgerEntries } from "../call/session-ledger";

/** Persist all locally derived candidates for one finalized utterance atomically. */
export async function appendCallSessionLedger(utterance: FinalUtterance): Promise<void> {
  const entries = deriveSessionLedgerEntries(utterance);
  if (!entries.length) return;
  const db = await getDatabase();
  const values = entries.map(() => "(?, ?, ?, ?, ?, 'candidate', ?)").join(", ");
  const args = entries.flatMap((entry) => [
    entry.id,
    entry.sessionId,
    entry.sourceUtteranceId,
    entry.kind,
    entry.excerpt,
    entry.createdAt,
  ]);
  await db.execute(
    `INSERT OR IGNORE INTO call_session_ledger
      (id, session_id, source_utterance_id, kind, excerpt, status, created_at)
     VALUES ${values}`,
    args
  );
}
