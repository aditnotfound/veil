/** Keep the initial call card quick without changing deep answers or custom providers. */
export function applyLiveAnswerProfile(
  body: Record<string, unknown>,
  providerId: string,
  profile: "default" | "live-short" | "deep",
  fastOpenAIAnswers = false
): void {
  if (profile !== "live-short" || providerId !== "openai") return;
  const model = body.model;
  if (typeof model !== "string" ||
      !/^gpt-6-(astra|sol|luna)(?:$|-)/i.test(model)) return;
  if (body.reasoning_effort === undefined) {
    body.reasoning_effort = /^(gpt-6-sol|gpt-6-luna)(?:$|-)/i.test(model)
      ? "none"
      : "low";
  }
  if (fastOpenAIAnswers && body.service_tier === undefined) {
    body.service_tier = "fast";
  }
}
