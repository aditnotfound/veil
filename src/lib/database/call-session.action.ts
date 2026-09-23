import { getDatabase } from "./config";
import type { FinalUtterance } from "../call/session-core";
import { buildCallSearchQuery } from "../call/local-search";
import { CALL_LEDGER_SQL, CALL_SUGGESTIONS_SQL, type StoredCallLedgerEntry, type StoredCallPlan, type StoredCallSuggestion } from "../call/session-review";
import type { ActiveSessionPlan } from "../call/session-planner";
import { appendCallSessionLedger } from "./call-session-ledger.action";

export interface StoredCallSession {
  id: string;
  started_at: number;
  ended_at: number | null;
  utterance_count: number;
  answer_count: number;
  deep_answer_count: number;
  ledger_count: number;
  planner_count: number;
}

export async function createCallSession(id: string, startedAt: number): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "INSERT INTO call_sessions (id, started_at) VALUES (?, ?)",
    [id, startedAt]
  );
}

export async function appendCallUtterance(utterance: FinalUtterance): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT OR IGNORE INTO call_utterances
      (id, session_id, source, sequence, started_at, ended_at, text)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [utterance.id, utterance.sessionId, utterance.source, utterance.sequence,
      utterance.startedAt, utterance.endedAt, utterance.text]
  );
}

export async function endCallSession(id: string, endedAt: number): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "UPDATE call_sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL",
    [endedAt, id]
  );
}

export async function deleteCallSession(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM call_sessions WHERE id = ?", [id]);
}

export async function deleteAllCallSessions(): Promise<number> {
  const db = await getDatabase();
  const result = await db.execute("DELETE FROM call_sessions");
  return result.rowsAffected;
}

export async function pruneCallSessionsOlderThan(cutoff: number): Promise<number> {
  if (!Number.isFinite(cutoff) || cutoff < 0) {
    throw new Error("Call retention cutoff must be a non-negative timestamp");
  }
  const db = await getDatabase();
  const result = await db.execute(
    "DELETE FROM call_sessions WHERE COALESCE(ended_at, started_at) < ?",
    [Math.floor(cutoff)]
  );
  return result.rowsAffected;
}

export async function listCallSessions(): Promise<StoredCallSession[]> {
  const db = await getDatabase();
  return db.select<StoredCallSession[]>(
    `SELECT s.id, s.started_at, s.ended_at, COUNT(u.id) AS utterance_count,
       (SELECT COUNT(*) FROM call_answer_cards c WHERE c.session_id = s.id) AS answer_count,
       (SELECT COUNT(*) FROM call_deep_answers d WHERE d.session_id = s.id) AS deep_answer_count,
       (SELECT COUNT(*) FROM call_session_ledger l WHERE l.session_id = s.id) AS ledger_count,
       (SELECT COUNT(*) FROM call_session_plans p WHERE p.session_id = s.id) AS planner_count
     FROM call_sessions s
     LEFT JOIN call_utterances u ON u.session_id = s.id
     GROUP BY s.id
     HAVING COUNT(u.id) > 0
     ORDER BY s.started_at DESC
     LIMIT 50`
  );
}

export interface CallUtteranceRevision {
  id: number;
  utteranceId: string;
  previousText: string;
  correctedText: string;
  correctedAt: number;
}

export async function getCallSessionPlans(sessionId: string): Promise<StoredCallPlan[]> {
  const db = await getDatabase();
  const rows = await db.select<Array<{
    revision: number;
    through_utterance_id: string;
    provider: string;
    model: string;
    plan_json: string;
    completed_at: number;
  }>>(
    `SELECT revision, through_utterance_id, provider, model, plan_json, completed_at
     FROM call_session_plans WHERE session_id = ? ORDER BY revision`,
    [sessionId]
  );
  return rows.map((row) => {
    const plan = JSON.parse(row.plan_json) as ActiveSessionPlan;
    return {
      revision: row.revision,
      throughUtteranceId: row.through_utterance_id,
      provider: row.provider,
      model: row.model,
      objective: plan.objective,
      activeTopic: plan.activeTopic,
      sourceUtteranceIds: plan.sourceUtteranceIds,
      unresolvedQuestions: plan.unresolvedQuestions,
      completedAt: row.completed_at,
    };
  });
}

export async function getCallSessionLedger(sessionId: string): Promise<StoredCallLedgerEntry[]> {
  const db = await getDatabase();
  const rows = await db.select<Array<{
    id: string;
    source_utterance_id: string;
    source: "system" | "mic";
    kind: StoredCallLedgerEntry["kind"];
    status: "candidate";
    excerpt: string;
    created_at: number;
  }>>(
    CALL_LEDGER_SQL,
    [sessionId]
  );
  return rows.map((row) => ({
    id: row.id,
    sourceUtteranceId: row.source_utterance_id,
    source: row.source,
    kind: row.kind,
    status: row.status,
    excerpt: row.excerpt,
    createdAt: row.created_at,
  }));
}

export async function getCallSuggestions(sessionId: string): Promise<StoredCallSuggestion[]> {
  const db = await getDatabase();
  const rows = await db.select<Array<{
    turn_id: string;
    tier: "initial" | "deep";
    status: "unverified" | "draft" | "grounded" | "checked" | "stale";
    prompt: string;
    provider: string;
    model: string;
    answer_text: string;
    question_ended_at: number;
    completed_at: number;
  }>>(
    CALL_SUGGESTIONS_SQL,
    [sessionId, sessionId]
  );
  return rows.map((row) => ({
    turnId: row.turn_id,
    tier: row.tier,
    status: row.status,
    prompt: row.prompt,
    provider: row.provider,
    model: row.model,
    answer: row.answer_text,
    questionEndedAt: row.question_ended_at,
    completedAt: row.completed_at,
  }));
}

export async function getCallUtterances(sessionId: string): Promise<FinalUtterance[]> {
  const db = await getDatabase();
  const rows = await db.select<Array<{
    id: string;
    session_id: string;
    source: "system" | "mic";
    sequence: number;
    started_at: number;
    ended_at: number;
    text: string;
  }>>(
    `SELECT id, session_id, source, sequence, started_at, ended_at, text
     FROM call_utterances WHERE session_id = ?
     ORDER BY started_at, ended_at, source, sequence`,
    [sessionId]
  );
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    source: row.source,
    sequence: row.sequence,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    text: row.text,
  }));
}

export async function correctCallUtterance(
  sessionId: string,
  utteranceId: string,
  correctedText: string
): Promise<{ utterance: FinalUtterance; ledgerRebuilt: boolean }> {
  const text = correctedText.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Corrected transcript cannot be empty");
  if (text.length > 10_000) throw new Error("Corrected transcript is too long");
  const db = await getDatabase();
  await db.execute(
    "UPDATE call_utterances SET text = ? WHERE id = ? AND session_id = ? AND text <> ?",
    [text, utteranceId, sessionId, text]
  );
  const rows = await db.select<Array<{
    id: string; session_id: string; source: "system" | "mic"; sequence: number;
    started_at: number; ended_at: number; text: string;
  }>>(
    `SELECT id, session_id, source, sequence, started_at, ended_at, text
     FROM call_utterances WHERE id = ? AND session_id = ?`,
    [utteranceId, sessionId]
  );
  const row = rows[0];
  if (!row) throw new Error("Call utterance was not found");
  const utterance: FinalUtterance = {
    id: row.id, sessionId: row.session_id, source: row.source, sequence: row.sequence,
    startedAt: row.started_at, endedAt: row.ended_at, text: row.text,
  };
  let ledgerRebuilt = true;
  try {
    await appendCallSessionLedger(utterance);
  } catch (error) {
    ledgerRebuilt = false;
    console.error("Corrected transcript saved, but candidate memory rebuild failed:", error);
  }
  return { utterance, ledgerRebuilt };
}

export async function restoreCallUtteranceRevision(
  sessionId: string,
  revisionId: number
): Promise<{ utterance: FinalUtterance; ledgerRebuilt: boolean }> {
  if (!Number.isInteger(revisionId) || revisionId <= 0) {
    throw new Error("Transcript revision identifier is invalid");
  }
  const db = await getDatabase();
  const rows = await db.select<Array<{
    utterance_id: string;
    previous_text: string;
  }>>(
    `SELECT utterance_id, previous_text
     FROM call_utterance_revisions
     WHERE id = ? AND session_id = ?`,
    [revisionId, sessionId]
  );
  const revision = rows[0];
  if (!revision) throw new Error("Transcript revision was not found");
  return correctCallUtterance(
    sessionId,
    revision.utterance_id,
    revision.previous_text
  );
}

export async function getCallUtteranceRevisions(sessionId: string): Promise<CallUtteranceRevision[]> {
  const db = await getDatabase();
  const rows = await db.select<Array<{
    id: number; utterance_id: string; previous_text: string; corrected_text: string; corrected_at: number;
  }>>(
    `SELECT id, utterance_id, previous_text, corrected_text, corrected_at
     FROM call_utterance_revisions WHERE session_id = ? ORDER BY corrected_at, id`,
    [sessionId]
  );
  return rows.map((row) => ({
    id: row.id,
    utteranceId: row.utterance_id,
    previousText: row.previous_text,
    correctedText: row.corrected_text,
    correctedAt: row.corrected_at,
  }));
}

/** Local lexical search over finalized turns. A pivot excludes simultaneous/future speech. */
export async function searchCallUtterances(
  sessionId: string, query: string, beforeId?: string, excludedIds: string[] = [], limit = 4
): Promise<FinalUtterance[]> {
  const plan = buildCallSearchQuery(sessionId, query, beforeId, excludedIds, limit);
  if (!plan) return [];
  const db = await getDatabase();
  const rows = await db.select<Array<{
    id: string; session_id: string; source: "system" | "mic"; sequence: number;
    started_at: number; ended_at: number; text: string;
  }>>(plan.sql, plan.args);
  return rows.map((row) => ({
    id: row.id, sessionId: row.session_id, source: row.source,
    sequence: row.sequence, startedAt: row.started_at, endedAt: row.ended_at,
    text: row.text,
  }));
}
