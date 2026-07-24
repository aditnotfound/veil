/**
 * Brief rationale for each curated Veil default prompt's recommended model.
 * Used in UI copy and docs — not enforced by the API layer.
 */
export const PROMPT_MODEL_RECOMMENDATIONS: Record<
  string,
  { model: string; provider: string; why: string }
> = {
  General: {
    model: "gpt-4o",
    provider: "openai",
    why: "Strong real-time reasoning and nuance for open-ended conversation support.",
  },
  Interview: {
    model: "gpt-4o",
    provider: "openai",
    why: "Better structured answers and STAR-style coaching under interview pressure.",
  },
  Coding: {
    model: "gpt-4o",
    provider: "openai",
    why: "Higher accuracy on algorithms, APIs, and speakable technical explanations.",
  },
  Translate: {
    model: "gpt-4o-mini",
    provider: "openai",
    why: "Fast, cheap turnaround for live translation without sacrificing clarity.",
  },
  Meeting: {
    model: "gpt-4o-mini",
    provider: "openai",
    why: "Low-latency note extraction for decisions and action items mid-meeting.",
  },
  Research: {
    model: "gpt-4o",
    provider: "openai",
    why: "Stronger claim/evidence separation and sharper verification suggestions.",
  },
  Help: {
    model: "gpt-4o-mini",
    provider: "openai",
    why: "Quick plain-language explanations that stay easy to skim in real time.",
  },
  Work: {
    model: "gpt-4o-mini",
    provider: "openai",
    why: "Snappy workplace replies and status framing at lower cost and latency.",
  },
};
