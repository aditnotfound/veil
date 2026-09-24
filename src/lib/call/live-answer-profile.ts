/** Keep the initial call card quick without changing deep answers or custom providers. */
export function applyLiveAnswerProfile(
  body: Record<string, unknown>,
  providerId: string,
  profile: "default" | "live-short" | "deep"
): void {
  if (profile !== "live-short" || providerId !== "openai" ||
      body.reasoning_effort !== undefined) return;
  const model = body.model;
  if (typeof model !== "string" ||
      !/^gpt-6-(astra|sol|luna)(?:$|-)/i.test(model)) return;
  body.reasoning_effort = /^(gpt-6-sol|gpt-6-luna)(?:$|-)/i.test(model)
    ? "none"
    : "low";
}
