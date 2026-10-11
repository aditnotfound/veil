/** Apply Fast processing to configured OpenAI GPT-6 answers without changing deep reasoning. */
export function applyLiveAnswerProfile(
  body: Record<string, unknown>,
  providerId: string,
  profile: "default" | "live-short" | "live-guided" | "deep",
  fastOpenAIAnswers = false
): void {
  if (providerId !== "openai") return;
  const model = body.model;
  if (typeof model !== "string" ||
      !/^gpt-6-(astra|sol|luna)(?:$|-)/i.test(model)) return;
  if (profile === "live-short" && body.reasoning_effort === undefined) {
    body.reasoning_effort = /^(gpt-6-sol|gpt-6-luna)(?:$|-)/i.test(model)
      ? "none"
      : "low";
  }
  if (profile === "live-guided" && body.reasoning_effort === undefined) {
    body.reasoning_effort = "low";
  }
  if (fastOpenAIAnswers && body.service_tier === undefined) {
    body.service_tier = "fast";
  }
}
