/** Approximate token-aware chunking (~4 chars/token). Target ~600 tokens with overlap. */
const TARGET_CHARS = 2400;
const OVERLAP_CHARS = 400;

export function chunkText(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  if (cleaned.length <= TARGET_CHARS) {
    return [cleaned];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(start + TARGET_CHARS, cleaned.length);
    if (end < cleaned.length) {
      const slice = cleaned.slice(start, end);
      const lastBreak = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". ")
      );
      if (lastBreak > TARGET_CHARS * 0.4) {
        end = start + lastBreak + 1;
      }
    }
    const piece = cleaned.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= cleaned.length) break;
    start = Math.max(0, end - OVERLAP_CHARS);
  }
  return chunks;
}
