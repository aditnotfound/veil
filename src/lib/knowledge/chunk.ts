/**
 * Section-aware chunking. Headings (Markdown, numbered, or common paper
 * sections) start a new section, and every chunk carries its section heading so
 * an excerpt about results is recognizable as coming from "Results".
 * ~1400 characters (~350 tokens) keeps excerpts precise and prompts short.
 */
const TARGET_CHARS = 1400;
const OVERLAP_CHARS = 200;
const PAPER_SECTIONS = /^(abstract|introduction|background|related work|preliminaries|method(s|ology)?|approach|model|data(set)?s?|experiment(s|al setup)?|results?|evaluation|analysis|discussion|limitations?|conclusions?|future work|references|bibliography|acknowledg(e)?ments?|appendix)\b/i;

function headingOf(line: string): string | null {
  const text = line.trim();
  if (!text || text.length > 90) return null;
  const markdown = text.match(/^#{1,6}\s+(.+)$/);
  if (markdown) return markdown[1].trim();
  if (/^(\d+(\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s+[A-Z][^.!?:]{1,80}$/.test(text)) return text;
  if (PAPER_SECTIONS.test(text) && !/[.!?,;]$/.test(text) && text.split(/\s+/).length <= 6) return text;
  return null;
}

function splitSection(body: string): string[] {
  if (body.length <= TARGET_CHARS) return [body];
  const pieces: string[] = [];
  let start = 0;
  while (start < body.length) {
    let end = Math.min(start + TARGET_CHARS, body.length);
    if (end < body.length) {
      const slice = body.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(". "));
      if (lastBreak > TARGET_CHARS * 0.4) end = start + lastBreak + 1;
    }
    const piece = body.slice(start, end).trim();
    if (piece) pieces.push(piece);
    if (end >= body.length) break;
    start = Math.max(start + 1, end - OVERLAP_CHARS);
  }
  return pieces;
}

export function chunkText(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  const sections: { heading: string; lines: string[] }[] = [{ heading: "", lines: [] }];
  for (const line of cleaned.split("\n")) {
    const heading = headingOf(line);
    if (heading) sections.push({ heading, lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }

  const chunks: string[] = [];
  for (const { heading, lines } of sections) {
    const body = lines.join("\n").trim();
    if (!body) continue;
    for (const piece of splitSection(body)) {
      chunks.push(heading ? `[${heading}]\n${piece}` : piece);
    }
  }
  return chunks.length ? chunks : [cleaned];
}
