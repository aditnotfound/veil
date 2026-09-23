import { getDatabase } from "./config";
import type { AutoResponseMode } from "../call/decision-router";
import { JEV_SHADOW_MODEL, type JevChoice, type JevShadowStatus } from "../call/jev-shadow";

export type StoredJevShadowStatus = JevShadowStatus |
  "unavailable" | "backpressure" | "out_of_scope" | "superseded";

export interface CallJevShadowRecord {
  turnId: string;
  sessionId: string;
  mode: AutoResponseMode;
  status: StoredJevShadowStatus;
  choice: JevChoice | null;
  confidence: number | null;
  latencyMs: number | null;
}

export async function saveCallJevShadow(record: CallJevShadowRecord): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT OR IGNORE INTO call_jev_shadow
      (turn_id, session_id, observed_at, model, mode, status, choice, confidence, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [record.turnId, record.sessionId, Date.now(), JEV_SHADOW_MODEL, record.mode,
      record.status, record.choice, record.confidence, record.latencyMs]
  );
}
