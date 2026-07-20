import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const EMBED_MODEL = "text-embedding-3-small";

export async function embedTexts(
  apiKey: string,
  texts: string[]
): Promise<number[][]> {
  if (!apiKey?.trim()) {
    throw new Error("OpenAI API key required for knowledge embeddings");
  }
  if (texts.length === 0) return [];

  const response = await tauriFetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Embedding failed (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as {
    data: { embedding: number[]; index: number }[];
  };

  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
