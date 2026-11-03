/** Add recent spoken context only when a short follow-up is missing its subject. */
export function callKnowledgeQuery(question: string, history: ReadonlyArray<{ content: unknown }>): string {
  const current = question.trim().slice(0, 400);
  const words = current.match(/[\p{L}\p{N}]+/gu) ?? [];
  const ambiguous = words.length <= 14 && /\b(?:it|its|that|those|this|these|they|them|there|so|why not|what about|how so)\b/i.test(current);
  if (!ambiguous) return current;
  const recent = history.slice(-2).map(item => typeof item.content === "string"
    ? item.content.replace(/^(?:System|Mic):\s*/i, "").trim().slice(0, 200) : "").filter(Boolean);
  return [current, ...recent.reverse()].join(" ").slice(0, 800);
}
