const MARKER = String.raw`\[\s*[KMCPL]\s*:[^\]\n]{1,160}\]`;
const MARKER_RUN = new RegExp(String.raw`[ \t]*${MARKER}(?:\s*[,;]?\s*${MARKER})*`, "g");
const EMPTY_PARENS = /[ \t]*\(\s*[,;]?\s*\)/g;
const MAX_HELD = 200;

/** Removes internal source labels such as [K:12] or [M:3f2a…] from model output. */
export function stripSourceMarkers(text: string): string {
  return text.replace(MARKER_RUN, "").replace(EMPTY_PARENS, "");
}

/**
 * Streaming variant: labels can be split across chunks, so an unclosed "[" and
 * trailing spaces are held back until the next chunk shows what they are.
 */
export function createSourceMarkerFilter() {
  let held = "";
  return {
    push(chunk: string): string {
      const text = held + chunk;
      let cut = text.length;
      const open = text.lastIndexOf("[");
      if (open >= 0 && text.indexOf("]", open) < 0 && text.length - open <= MAX_HELD) cut = open;
      while (cut > 0 && /[ \t(]/.test(text[cut - 1])) cut--;
      const ready = stripSourceMarkers(text.slice(0, cut));
      held = text.slice(cut);
      return ready;
    },
    flush(): string {
      const rest = stripSourceMarkers(held);
      held = "";
      return rest;
    },
  };
}
