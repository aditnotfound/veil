/** Keep saved call preparation stable; an explicitly empty snapshot must stay empty. */
export async function resolveAnswerContext(options: {
  isEnabled: () => boolean;
  mode?: string;
  preparedContext?: string;
  loadCurrent: () => Promise<string>;
  search: () => Promise<string>;
}): Promise<{ context: string; failed: boolean }> {
  if (options.mode === "none" || !options.isEnabled()) return { context: "", failed: false };
  const results = await Promise.allSettled([
    options.preparedContext === undefined ? options.loadCurrent() : Promise.resolve(options.preparedContext),
    options.search(),
  ]);
  // A user can turn knowledge off while a slow semantic search is pending.
  if (!options.isEnabled()) return { context: "", failed: false };
  const failed = results.some((result) => result.status === "rejected");
  const context = results.flatMap((result, index) => result.status === "fulfilled" ? [result.value] : [
    index === 0 ? "User background could not be loaded for this answer. Do not infer missing personal facts."
      : "Personal knowledge search failed for this answer. Do not claim the library was checked.",
  ]).filter(Boolean).join("\n\n");
  return { context, failed };
}
