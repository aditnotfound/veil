/** A provider stream must contain visible text before it can count as an answer. */
export function hasUsableAnswer(text: string): boolean {
  return typeof text === "string" && text.trim().length > 0;
}
