export type ScriptWord = { text: string; normalized: string; paragraphStart: boolean };
export type ScriptLine = { start: number; end: number };

export function normalizeWord(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function scriptWords(text: string): ScriptWord[] {
  const words: ScriptWord[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let first = true;
    for (const piece of paragraph.match(/\S+/gu) ?? []) {
      const normalized = normalizeWord(piece);
      if (!normalized) {
        if (words.length) words[words.length - 1].text += ` ${piece}`;
        continue;
      }
      words.push({ text: piece, normalized, paragraphStart: first && words.length > 0 });
      first = false;
    }
  }
  return words;
}

export function scriptLines(words: ScriptWord[], maxCharacters = 44): ScriptLine[] {
  return fitScriptLines(words, maxCharacters, (text) => text.length, 1);
}

/** Measure the actual rendered typeface so resizing and larger text never clip a line. */
export function fitScriptLines(
  words: ScriptWord[], maxWidth: number, measure: (text: string) => number, gap = 6
): ScriptLine[] {
  const lines: ScriptLine[] = [];
  let start = 0;
  let length = 0;
  for (let index = 0; index < words.length; index++) {
    const size = measure(words[index].text);
    if (index > start && (words[index].paragraphStart || length + gap + size > maxWidth)) {
      lines.push({ start, end: index });
      start = index;
      length = 0;
    }
    length += (index > start ? gap : 0) + size;
  }
  if (start < words.length) lines.push({ start, end: words.length });
  return lines;
}

const COMMON_WORDS = new Set("a an and are as at be by for from i in is it of on or that the this to was we with you".split(" "));

function wordMatch(a: string, b: string): number {
  if (a === b) return 3;
  // A small spelling error can support a phrase, but cannot advance on its own.
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return -2;
  let left = 0;
  let right = 0;
  let edits = 0;
  while (left < a.length && right < b.length) {
    if (a[left] === b[right]) { left++; right++; continue; }
    if (++edits > 1) return -2;
    if (a.length >= b.length) left++;
    if (b.length >= a.length) right++;
  }
  return edits + (a.length - left) + (b.length - right) <= 1 ? 1.5 : -2;
}

type Alignment = {
  score: number; matches: number; exact: number; meaningful: number;
  scriptStart: number; speechStart: number;
};

/**
 * Align a bounded caption suffix to nearby script text, allowing omissions,
 * substitutions, fillers and repeated words. Require matching words AFTER an
 * error before skipping it. Old caption context anchors corrections and repeated
 * phrases; the cursor never moves backwards or advances on unrelated speech.
 */
export function advanceScriptCursor(
  words: ScriptWord[], cursor: number, previousCaption: string, caption: string
): number {
  const before = (previousCaption.match(/\S+/gu) ?? []).map(normalizeWord).filter(Boolean);
  const current = (caption.match(/\S+/gu) ?? []).map(normalizeWord).filter(Boolean);
  let common = 0;
  while (common < before.length && common < current.length && before[common] === current[common]) common++;
  const position = Math.max(0, Math.min(cursor, words.length));
  if (common === current.length || position === words.length) return position;
  const speechOffset = Math.max(0, Math.min(common - 10, current.length - 1), current.length - 48);
  const spoken = current.slice(speechOffset);
  const windowStart = Math.max(0, position - 48);
  const windowEnd = Math.min(words.length, position + 80);
  const width = windowEnd - windowStart;
  let previous: (Alignment | null)[] = Array(width + 1).fill(null);
  let bestScore = 0;
  let bestEnd = position;
  for (let i = 0; i < spoken.length; i++) {
    const row: (Alignment | null)[] = Array(width + 1).fill(null);
    for (let j = 1; j <= width; j++) {
      const scriptIndex = windowStart + j - 1;
      const match = wordMatch(spoken[i], words[scriptIndex].normalized);
      const diagonal = previous[j - 1];
      let cell: Alignment = {
        score: (diagonal?.score ?? 0) + match,
        matches: (diagonal?.matches ?? 0) + Number(match > 0),
        exact: (diagonal?.exact ?? 0) + Number(match === 3),
        meaningful: (diagonal?.meaningful ?? 0) + Number(match === 3 && !COMMON_WORDS.has(spoken[i])),
        scriptStart: diagonal?.scriptStart ?? scriptIndex,
        speechStart: diagonal?.speechStart ?? i,
      };
      // Spoken fillers/restarts are cheaper than skipping script text, so a
      // repeated word does not jump to a later copy of the same sentence.
      for (const [neighbor, penalty] of [[previous[j], 1.2], [row[j - 1], 2]] as const) {
        if (neighbor && neighbor.score - penalty > cell.score) cell = { ...neighbor, score: neighbor.score - penalty };
      }
      if (cell.score <= 0) continue;
      row[j] = cell;
      // Only evaluate a real terminal match, never a trailing skipped/misheard word.
      if (match !== 3 || cell.score !== (diagonal?.score ?? 0) + match || i + speechOffset < common) continue;
      const jump = Math.max(0, cell.scriptStart - position);
      const scriptSpan = scriptIndex - cell.scriptStart + 1;
      const speechSpan = i - cell.speechStart + 1;
      const density = cell.matches / Math.max(scriptSpan, speechSpan);
      const enoughEvidence = jump === 0 ||
        (jump <= 2 && cell.meaningful >= 1) ||
        (jump <= 10 && cell.exact >= 2 && cell.meaningful >= 1) ||
        (cell.exact >= 3 && cell.meaningful >= 2);
      if (!enoughEvidence || density < 0.55) continue;
      // Prefer the nearby occurrence when a script repeats the same phrase.
      const score = cell.score - jump * 0.15 - (spoken.length - i - 1) * 0.1;
      if (score > bestScore + 0.001 || (Math.abs(score - bestScore) < 0.001 && scriptIndex + 1 < bestEnd)) {
        bestScore = score;
        bestEnd = scriptIndex + 1;
      }
    }
    previous = row;
  }
  return Math.max(position, bestEnd);
}
