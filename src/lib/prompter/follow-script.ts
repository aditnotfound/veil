export type ScriptWord = { text: string; normalized: string; paragraphStart: boolean };
export type ScriptLine = { start: number; end: number };

export function normalizeWord(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
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
  const lines: ScriptLine[] = [];
  let start = 0;
  let length = 0;
  for (let index = 0; index < words.length; index++) {
    const size = words[index].text.length;
    if (index > start && (words[index].paragraphStart || length + 1 + size > maxCharacters)) {
      lines.push({ start, end: index });
      start = index;
      length = 0;
    }
    length += (index > start ? 1 : 0) + size;
  }
  if (start < words.length) lines.push({ start, end: words.length });
  return lines;
}

/** Progress only when live-caption words match nearby script words or a two-word anchor. */
export function advanceScriptCursor(
  words: ScriptWord[], cursor: number, previousCaption: string, caption: string
): number {
  const before = (previousCaption.match(/\S+/gu) ?? []).map(normalizeWord).filter(Boolean);
  const current = (caption.match(/\S+/gu) ?? []).map(normalizeWord).filter(Boolean);
  let common = 0;
  while (common < before.length && common < current.length && before[common] === current[common]) common++;
  let next = Math.max(0, Math.min(cursor, words.length));
  const spoken = current.slice(common);
  for (let index = 0; index < spoken.length && next < words.length; index++) {
    if (spoken[index] === words[next].normalized) {
      next++;
      continue;
    }
    // Two consecutive words give enough evidence to follow a skipped phrase.
    if (index + 1 < spoken.length) {
      const limit = Math.min(words.length - 1, next + 30);
      let anchor = -1;
      for (let candidate = next + 1; candidate <= limit; candidate++) {
        if (words[candidate].normalized === spoken[index] &&
          words[candidate + 1].normalized === spoken[index + 1]) {
          anchor = candidate;
          break;
        }
      }
      if (anchor >= 0) {
        next = anchor + 2;
        index++;
        continue;
      }
    }
    // STT may omit a short word, but a single common word must not skip a line.
    for (let candidate = next + 1; candidate <= Math.min(next + 2, words.length - 1); candidate++) {
      if (words[candidate].normalized === spoken[index] && spoken[index].length >= 4) {
        next = candidate + 1;
        break;
      }
    }
  }
  return next;
}
