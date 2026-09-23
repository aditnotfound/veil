import { CallSessionCore, type FinalUtterance } from "./session-core.ts";

export interface StoredCallSuggestion {
  turnId: string;
  tier: "initial" | "deep";
  status: "unverified" | "draft" | "grounded" | "checked" | "stale";
  prompt: string;
  provider: string;
  model: string;
  answer: string;
  questionEndedAt: number;
  completedAt: number;
}

export interface StoredCallLedgerEntry {
  id: string;
  sourceUtteranceId: string;
  source: "system" | "mic";
  kind: "person" | "fact" | "number" | "decision" | "commitment" | "unresolved_question";
  status: "candidate";
  excerpt: string;
  createdAt: number;
}

export interface StoredCallPlan {
  revision: number;
  throughUtteranceId: string;
  provider: string;
  model: string;
  objective: string | null;
  activeTopic: string | null;
  sourceUtteranceIds: string[];
  unresolvedQuestions: Array<{ text: string; sourceUtteranceIds: string[] }>;
  completedAt: number;
}

export const CALL_SUGGESTIONS_SQL = `SELECT c.turn_id, 'initial' AS tier,
       CASE WHEN i.turn_id IS NULL THEN 'unverified' ELSE 'stale' END AS status,
       u.text AS prompt, c.provider, c.model, c.answer_text,
       u.ended_at AS question_ended_at, c.completed_at
     FROM call_answer_cards c
     JOIN call_utterances u ON u.id = c.turn_id
     LEFT JOIN call_answer_invalidations i ON i.turn_id = c.turn_id AND i.tier = 'initial'
     WHERE c.session_id = ?
     UNION ALL
     SELECT d.turn_id, 'deep' AS tier,
       CASE WHEN i.turn_id IS NULL THEN d.status ELSE 'stale' END AS status,
       u.text AS prompt, d.provider, d.model, d.answer_text,
       u.ended_at AS question_ended_at, d.completed_at
     FROM call_deep_answers d
     JOIN call_utterances u ON u.id = d.turn_id
     LEFT JOIN call_answer_invalidations i ON i.turn_id = d.turn_id AND i.tier = 'deep'
     WHERE d.session_id = ?
     ORDER BY completed_at, tier`;

export const CALL_LEDGER_SQL = `SELECT l.id, l.source_utterance_id, u.source,
       l.kind, l.status, l.excerpt, l.created_at
     FROM call_session_ledger l
     JOIN call_utterances u ON u.id = l.source_utterance_id
     WHERE l.session_id = ?
     ORDER BY l.created_at, l.source_utterance_id, l.kind`;

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeMarkdown(value: string): string {
  return singleLine(value).replace(/([\\`*_{}[\]()<>#+.!|~-])/g, "\\$1");
}

/** Reconstruct the bounded, chronological transcript window for review-time regeneration. */
export function buildCallReviewHistory(
  utterances: FinalUtterance[],
  turnId: string
): Array<{ role: "user"; content: string }> {
  const ordered = [...utterances].sort(
    (left, right) => left.startedAt - right.startedAt ||
      left.endedAt - right.endedAt || left.source.localeCompare(right.source) ||
      left.sequence - right.sequence
  );
  const sessionId = ordered.find((utterance) => utterance.id === turnId)?.sessionId;
  if (!sessionId) return [];
  const core = new CallSessionCore();
  core.start(sessionId);
  for (const utterance of ordered) core.appendFinal(utterance);
  return core.historyEntriesBefore(turnId).map((entry) => ({
    role: entry.role,
    content: `[C:${entry.id}] ${entry.content}`,
  }));
}

/** Add the current short card as explicitly unverified context for a deep replacement. */
export function buildDeepCallReviewHistory(
  utterances: FinalUtterance[],
  turnId: string,
  initialAnswer: string
): Array<{ role: "user" | "assistant"; content: string }> {
  const answer = initialAnswer.trim();
  if (!answer) return [];
  return [
    ...buildCallReviewHistory(utterances, turnId),
    {
      role: "assistant",
      content: `Current initial live-call suggestion (unverified):\n${answer}`,
    },
  ];
}

/** Render exact, locally classified transcript excerpts for source inspection. */
export function formatCallLedger(
  entries: StoredCallLedgerEntry[],
  formatTime: (timestamp: number) => string
): string {
  return entries.map((entry) => [
    `### ${entry.kind.replace(/_/g, " ")} · ${entry.status}`,
    `Source: [C:${entry.sourceUtteranceId}] · ${formatTime(entry.createdAt)} · ${entry.source === "mic" ? "Mic" : "System"}`,
    "",
    escapeMarkdown(entry.excerpt),
  ].join("\n")).join("\n\n");
}

export function formatCallPlans(
  plans: StoredCallPlan[],
  formatTime: (timestamp: number) => string
): string {
  return plans.map((plan) => {
    const model = plan.model ? ` · ${escapeMarkdown(plan.model)}` : "";
    const lines = [
      `### Planner revision ${plan.revision} · candidate`,
      `Through: [C:${plan.throughUtteranceId}] · ${formatTime(plan.completedAt)} · ${escapeMarkdown(plan.provider)}${model}`,
    ];
    if (plan.objective) lines.push(`Objective: ${escapeMarkdown(plan.objective)}`);
    if (plan.activeTopic) lines.push(`Active topic: ${escapeMarkdown(plan.activeTopic)}`);
    if (plan.sourceUtteranceIds.length) {
      lines.push(`Sources: ${plan.sourceUtteranceIds.map((id) => `[C:${id}]`).join(", ")}`);
    }
    for (const question of plan.unresolvedQuestions) {
      lines.push(`Unresolved: ${escapeMarkdown(question.text)} ${question.sourceUtteranceIds.map((id) => `[C:${id}]`).join(" ")}`.trim());
    }
    return lines.join("\n\n");
  }).join("\n\n");
}

/** Render generated suggestions separately from transcript and human notes. */
export function formatCallSuggestions(
  suggestions: StoredCallSuggestion[],
  formatTime: (timestamp: number) => string
): string {
  return [...suggestions]
    .sort((left, right) => left.completedAt - right.completedAt || left.tier.localeCompare(right.tier))
    .map((suggestion) => {
      const tier = suggestion.tier === "initial" ? "Initial card" : "Deep answer";
      const model = suggestion.model ? ` · ${suggestion.model}` : "";
      return [
        `### ${tier} · ${suggestion.status}`,
        `Source: [C:${suggestion.turnId}] · ${formatTime(suggestion.completedAt)} · ${suggestion.provider}${model}`,
        `Question: ${singleLine(suggestion.prompt)}`,
        "",
        suggestion.answer.trim(),
      ].join("\n");
    })
    .join("\n\n");
}
