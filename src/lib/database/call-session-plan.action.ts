import { getDatabase } from "./config";
import type { ActiveSessionPlan } from "../call/session-planner";

export async function saveCallSessionPlan(params: {
  plan: ActiveSessionPlan;
  provider: string;
  model: string;
  startedAt: number;
  completedAt: number;
}): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO call_session_plans
      (session_id, revision, through_utterance_id, provider, model, plan_json, status, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, 'candidate', ?, ?)`,
    [params.plan.sessionId, params.plan.revision, params.plan.throughUtteranceId,
      params.provider, params.model, JSON.stringify(params.plan), params.startedAt, params.completedAt]
  );
}

export async function deleteCallSessionPlanRevision(sessionId: string, revision: number): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "DELETE FROM call_session_plans WHERE session_id = ? AND revision = ?",
    [sessionId, revision]
  );
}
