import type { FinalUtterance } from "./session-core";

export const LEDGER_VERSION = "local-excerpts-v1";
export type SessionLedgerKind =
  | "person"
  | "fact"
  | "number"
  | "decision"
  | "commitment"
  | "unresolved_question";

export interface SessionLedgerEntry {
  id: string;
  sessionId: string;
  sourceUtteranceId: string;
  source: FinalUtterance["source"];
  kind: SessionLedgerKind;
  excerpt: string;
  createdAt: number;
}

const MAX_EXCERPT_CHARS = 400;
const MAX_PROMPT_ENTRIES = 16;
const MAX_PROMPT_CHARS = 3_200;
const QUESTION_START = /^(?:who|what|when|where|why|how|which|whose|is|are|was|were|do|does|did|can|could|would|should|will|have|has|may)\b/i;
const PERSON = /\b(?:my name is|this is|meet|speaking with|talking to|i am|i'm)\s+[A-Z][\p{L}'-]*(?:\s+[A-Z][\p{L}'-]*){0,2}\b/u;
const DECISION = /\b(?:(?:we|i)\s+(?:decided|agreed|chose|selected|will go with|are going with)|the decision is|the final choice is)\b/i;
const COMMITMENT = /\b(?:(?:i|we)\s+(?:will|shall|promise|commit|need to|have to|must)|i['’]ll|we['’]ll|let['’]?s)\b/i;
const NUMBER = /(?:[$₹€£]\s*)?\b\d+(?:[,.]\d+)*(?:\s?(?:%|percent|ms|seconds?|minutes?|hours?|days?|weeks?|months?|years?))?\b/i;
const FACT = /\b(?:is|are|was|were|has|have|uses?|runs?|costs?|means?|works?|requires?|contains?|includes?)\b/i;

function compactExcerpt(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= MAX_EXCERPT_CHARS
    ? compact
    : `${compact.slice(0, MAX_EXCERPT_CHARS - 1).trimEnd()}…`;
}

/** Classify exact transcript text only. Every result remains an unverified candidate. */
export function deriveSessionLedgerEntries(utterance: FinalUtterance): SessionLedgerEntry[] {
  const excerpt = compactExcerpt(utterance.text);
  if (!excerpt) return [];
  const kinds: SessionLedgerKind[] = [];
  const isQuestion = excerpt.includes("?") || QUESTION_START.test(excerpt);
  if (PERSON.test(excerpt)) kinds.push("person");
  if (NUMBER.test(excerpt)) kinds.push("number");
  if (DECISION.test(excerpt)) kinds.push("decision");
  if (COMMITMENT.test(excerpt)) kinds.push("commitment");
  if (isQuestion) kinds.push("unresolved_question");
  if (!isQuestion && !kinds.includes("decision") && !kinds.includes("commitment") &&
      excerpt.split(" ").length >= 4 && FACT.test(excerpt)) kinds.push("fact");
  return kinds.map((kind) => ({
    id: `${utterance.id}:ledger:${kind}`,
    sessionId: utterance.sessionId,
    sourceUtteranceId: utterance.id,
    source: utterance.source,
    kind,
    excerpt,
    createdAt: utterance.endedAt,
  }));
}

/** Select bounded earlier candidates, excluding turns already present in recent history. */
export function selectSessionLedgerEntries(
  utterances: FinalUtterance[],
  beforeId: string,
  excludedUtteranceIds: string[] = []
): SessionLedgerEntry[] {
  const ordered = [...utterances].sort((a, b) =>
    a.startedAt - b.startedAt || a.endedAt - b.endedAt ||
    a.source.localeCompare(b.source) || a.sequence - b.sequence
  );
  const pivot = ordered.findIndex(({ id }) => id === beforeId);
  const earlier = pivot < 0 ? ordered : ordered.slice(0, pivot);
  const excluded = new Set(excludedUtteranceIds);
  const selected: SessionLedgerEntry[] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (let i = earlier.length - 1; i >= 0 && selected.length < MAX_PROMPT_ENTRIES; i--) {
    const utterance = earlier[i];
    if (excluded.has(utterance.id)) continue;
    const entries = deriveSessionLedgerEntries(utterance);
    for (let j = entries.length - 1; j >= 0 && selected.length < MAX_PROMPT_ENTRIES; j--) {
      const entry = entries[j];
      const duplicateKey = `${entry.kind}:${entry.excerpt.toLowerCase()}`;
      if (seen.has(duplicateKey)) continue;
      const nextChars = entry.excerpt.length + entry.kind.length + 32;
      if (chars + nextChars > MAX_PROMPT_CHARS) continue;
      seen.add(duplicateKey);
      chars += nextChars;
      selected.push(entry);
    }
  }
  return selected.reverse();
}

export function formatSessionLedgerEvidence(entries: SessionLedgerEntry[]): string {
  if (!entries.length) return "";
  return [
    `## Candidate session ledger (${LEDGER_VERSION})`,
    "These are exact transcript excerpts selected locally. They may be mistaken, stale, unresolved, or contradicted. Treat their labels as routing hints, not verified facts, and cite [C:id] when relying on one.",
    ...entries.map((entry) =>
      `- [L:${entry.id}] [${entry.kind}] [C:${entry.sourceUtteranceId}] ${entry.source === "mic" ? "Mic" : "System"}: ${entry.excerpt}`
    ),
  ].join("\n");
}
