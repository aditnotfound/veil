export const VOICE_STORAGE_KEY = "veil_answer_voice";
export const VOICE_LIMITS = { style: 600, samples: 4000 } as const;

export interface AnswerVoice {
  style: string;
  samples: string;
}

export const EMPTY_VOICE: AnswerVoice = { style: "", samples: "" };

const WRITING_RULES = [
  "How to write the answer: sound like a real person talking, not an assistant.",
  "Start with the answer itself. Never restate the question or open with praise or acknowledgements (\"Great question\", \"Certainly\", \"Sure\", \"Absolutely\", \"That's a good point\").",
  "Write connected sentences in short paragraphs, the way people actually answer. No bullet points, numbered lists, headings, bold text or emojis unless the user asks for a list or the content is code, math or setup steps that genuinely need it.",
  "Choose the length yourself, the way a person would. A quick factual question gets a sentence. Most questions get a few sentences. Only go longer when someone asks you to walk through or explain something in depth. Stop once the point is made: no recap, no \"Overall\" or \"In short\", no offer of more help, no \"Let me know\".",
  "Keep sentences tight. Cut filler words (basically, actually, really, just, honestly, kind of, essentially) and don't chain clauses with \"and\", \"so\" or \"which\" when two sentences read cleaner. Don't stack transitions like additionally, furthermore, moreover.",
  "Use plain, everyday words and contractions. Avoid wording that gives AI writing away: delve, crucial, pivotal, key (as an adjective), leverage, robust, seamless, landscape, tapestry, testament, underscore, foster, showcase, vibrant, intricate, \"it's important to note\", \"not just X but Y\", \"it's not X, it's Y\", lists of three for rhythm, and trailing -ing phrases such as \"ensuring…\" or \"highlighting…\".",
  "Don't use em dashes or en dashes. Use commas, periods or parentheses.",
  "Be specific. A concrete number, name or example beats a general claim, but never invent one to sound specific. If you don't know, say so plainly in one short sentence.",
].join(" ");

const LIVE_RULES = "This answer is something the user will say out loud on a live call, so write it in the first person as the user, in words they could say naturally without reading it like a script.";

export function normalizeVoice(value: unknown): AnswerVoice {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: keyof AnswerVoice) =>
    typeof source[key] === "string" ? (source[key] as string).trim().slice(0, VOICE_LIMITS[key]) : "";
  return { style: text("style"), samples: text("samples") };
}

/** Writing rules for every answer, with the user's own voice taking priority. */
export function buildVoicePrompt(voice: AnswerVoice, live = false): string {
  const parts = [WRITING_RULES];
  if (live) parts.push(LIVE_RULES);
  if (voice.style) {
    parts.push(`The user describes how they want answers to sound: ${JSON.stringify(voice.style)}`);
  }
  if (voice.samples) {
    parts.push(`Samples of how the user actually talks and writes are below. Match their sentence length, vocabulary, rhythm, punctuation and tone. Copy their voice, not their content.\n<samples>\n${voice.samples}\n</samples>`);
  }
  if (voice.style || voice.samples) {
    parts.push("Where the user's style or samples conflict with the general writing rules, follow the user.");
  }
  return parts.join("\n\n");
}

export function loadVoice(): AnswerVoice {
  try {
    const raw = localStorage.getItem(VOICE_STORAGE_KEY);
    return raw ? normalizeVoice(JSON.parse(raw)) : { ...EMPTY_VOICE };
  } catch {
    return { ...EMPTY_VOICE };
  }
}

export function saveVoice(voice: AnswerVoice): AnswerVoice {
  const value = normalizeVoice(voice);
  localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(value));
  return value;
}
