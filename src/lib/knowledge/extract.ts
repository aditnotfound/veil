/** Extracts text from a PDF, keeping line breaks so headings stay detectable. */
async function extractPdfText(file: File): Promise<string> {
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str + (item.hasEOL ? "\n" : item.str.endsWith(" ") ? "" : " ");
      }
      pages.push(text.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim());
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  // Rejoin words hyphenated across line breaks.
  const joined = pages.filter(Boolean).join("\n\n").replace(/(\w)-\n(\w)/g, "$1$2");
  if (joined.replace(/\s/g, "").length < 40) {
    throw new Error(`${file.name} has no selectable text. It may be a scanned PDF; paste its text as a note instead.`);
  }
  return joined;
}

/** Extract plain text from uploaded files (browser File). */
export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const type = file.type;

  if (name.endsWith(".pdf") || type === "application/pdf") {
    return extractPdfText(file);
  }

  if (
    type.startsWith("text/") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".csv") ||
    name.endsWith(".json")
  ) {
    return file.text();
  }

  // Best-effort: try reading as text for unknown types
  try {
    const text = await file.text();
    if (text.includes("\u0000")) throw new Error("binary");
    if (text.trim().length > 40) return text;
  } catch {
    // fall through
  }

  throw new Error(
    `Unsupported file type for extraction: ${file.name}. Use PDF, TXT, MD, CSV, or JSON, or paste text as a note.`
  );
}
