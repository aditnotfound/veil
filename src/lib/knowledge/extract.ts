/** Extract plain text from uploaded files (browser File). */
export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const type = file.type;

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
    // Heuristic: binary PDFs often contain lots of nulls
    if (text.includes("\u0000") || /%PDF/.test(text.slice(0, 8))) {
      throw new Error("binary");
    }
    if (text.trim().length > 40) return text;
  } catch {
    // fall through
  }

  throw new Error(
    `Unsupported file type for extraction: ${file.name}. Use TXT, MD, CSV, or paste text as a note. For PDF/DOCX, paste extracted text into a note for now.`
  );
}
