import { getDatabase } from "./config";
import { ROUTER_VERSION, type AutoResponseMode, type CallDecision } from "../call/decision-router";

export async function saveCallTurnDecision(
  sessionId: string,
  decision: CallDecision,
  mode: AutoResponseMode,
  decidedAt: number
): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT OR IGNORE INTO call_turn_decisions
      (turn_id, session_id, decided_at, router_version, mode, action, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [decision.utteranceId, sessionId, decidedAt, ROUTER_VERSION,
      mode, decision.action, decision.reason]
  );
}
