import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input, Label, Switch, Textarea } from "@/components";
import { Brain, Pencil, Pin, PinOff, Search, Trash2, Upload } from "lucide-react";
import { extractTextFromFile } from "@/lib/knowledge";
import {
  deleteMemories, listMemories, memoryFromCallsEnabled, MEMORY_FROM_CALLS_KEY, parseMemoryImport,
  recall, saveMemories, warmRecall, type MemoryItem, type MemoryKind, type MemoryLayer, type RecallHit, type RecallStatus,
} from "@/lib/memory";

type Filter = "all" | MemoryLayer;

const LAYER_LABEL: Record<MemoryLayer, string> = { core: "Core", shared: "Shared", call: "From calls" };
const KIND_LABEL: Record<MemoryKind, string> = {
  fact: "Fact", preference: "Preference", episode: "Call summary", qa: "Q&A", followup: "Follow-up", note: "Note",
};

function originLabel(item: MemoryItem): string {
  if (item.origin.startsWith("import:")) return `Imported from ${item.origin.slice(7)}`;
  if (item.origin.startsWith("call:")) return "Learned from a call";
  return "Added by you";
}

export function Memory() {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [status, setStatus] = useState<RecallStatus | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [draftLayer, setDraftLayer] = useState<MemoryLayer>("shared");
  const [importText, setImportText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [learnFromCalls, setLearnFromCalls] = useState(memoryFromCallsEnabled);
  const [probe, setProbe] = useState("");
  const [probeHits, setProbeHits] = useState<RecallHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try { setItems(await listMemories()); }
    catch { setError("Could not load memories. Please reopen this page."); }
  }, []);

  useEffect(() => {
    void load();
    warmRecall().then(setStatus).catch(() => setStatus(null));
    const refresh = () => { void load(); };
    window.addEventListener("memory-changed", refresh);
    return () => window.removeEventListener("memory-changed", refresh);
  }, [load]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  const importMemories = (raw: string, source: string) => run(async () => {
    const texts = parseMemoryImport(raw);
    if (!texts.length) throw new Error("No memories found. Put one memory per line, as a bullet list, or as a JSON list.");
    const saved = await saveMemories(texts.map((text) => ({ layer: "shared" as const, kind: "note" as const, text, origin: `import:${source}` })));
    const merged = saved.filter((item) => item.merged).length;
    setImportText("");
    setNotice(`Imported ${saved.length - merged} new memories${merged ? ` and refreshed ${merged} you already had` : ""}.`);
  });

  const counts = useMemo(() => ({
    all: items.length,
    core: items.filter((item) => item.layer === "core").length,
    shared: items.filter((item) => item.layer === "shared").length,
    call: items.filter((item) => item.layer === "call").length,
  }), [items]);

  const shown = items.filter((item) =>
    (filter === "all" || item.layer === filter) &&
    (!search.trim() || item.text.toLowerCase().includes(search.trim().toLowerCase()))
  );
  const coreChars = items.filter((item) => item.layer === "core" && item.enabled).reduce((sum, item) => sum + item.text.length, 0);

  return <div className="space-y-5">
    <div className="rounded-xl border p-4 space-y-1">
      <h2 className="font-medium flex items-center gap-2"><Brain className="size-4" />How Veil remembers</h2>
      <p className="text-sm text-muted-foreground"><strong>Core</strong> memories go into every answer. <strong>Shared</strong> memories and memories <strong>from calls</strong> are recalled only when they match what is being discussed, by keyword or by meaning. Everything stays on this device; only recalled memories are sent with an answer.</p>
      <p className="text-xs text-muted-foreground">{status === null ? "On-device recall is starting…" : status.modelReady ? `On-device recall ready · ${status.items.toLocaleString()} items indexed${status.indexing ? " · indexing new items in the background" : ""}` : "Meaning search is unavailable; recall uses keywords only."}</p>
    </div>

    {error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}

    <form className="rounded-xl border p-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void run(async () => {
      const [saved] = await saveMemories([{ layer: draftLayer, kind: "fact", text: draft, origin: "you" }]);
      setDraft("");
      setNotice(saved?.merged ? "That matched something Veil already knew, so it was updated." : "Remembered.");
    }); }}>
      <Label htmlFor="memory-draft">Tell Veil something to remember</Label>
      <Textarea id="memory-draft" placeholder="For example: My thesis is on low-resource speech recognition; my advisor is Prof. Rao." value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} className="min-h-20" maxLength={2000} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border p-0.5" role="radiogroup" aria-label="Memory layer">
          {(["shared", "core"] as const).map((layer) => <button key={layer} type="button" role="radio" aria-checked={draftLayer === layer} onClick={() => setDraftLayer(layer)} className={`rounded-md px-3 py-1 text-xs ${draftLayer === layer ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{layer === "core" ? "Core · always used" : "Shared · used when relevant"}</button>)}
        </div>
        <Button type="submit" disabled={busy || !draft.trim()}>Remember</Button>
      </div>
    </form>

    <div className="rounded-xl border p-4 space-y-3">
      <h2 className="font-medium">Import memories</h2>
      <p className="text-xs text-muted-foreground">Paste a list (one memory per line or bullet), or import a file. A ChatGPT memory export or any JSON list of strings works too. Near-duplicates are merged automatically.</p>
      <Textarea aria-label="Memories to import" placeholder={"- I prefer concise answers with one example\n- I'm presenting my paper at ACL in July"} value={importText} onChange={(e) => setImportText(e.target.value)} disabled={busy} className="min-h-24" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={busy || !importText.trim()} onClick={() => void importMemories(importText, "pasted list")}>Import {importText.trim() ? parseMemoryImport(importText).length : ""} memories</Button>
        <Label htmlFor="memory-upload" className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}><Upload className="size-4" />Import file</Label>
        <input id="memory-upload" type="file" className="hidden" accept=".txt,.md,.json,.csv,.pdf" disabled={busy} onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
          void (async () => {
            try { await importMemories(await extractTextFromFile(file), file.name); }
            catch (err) { setError(err instanceof Error ? err.message : String(err)); }
          })();
        }} />
      </div>
    </div>

    <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
      <div><Label htmlFor="learn-from-calls">Learn from calls</Label><p className="text-xs text-muted-foreground mt-1">After each Listen session, your answer provider summarizes the call into memories: what was discussed, questions you were asked and how you answered, facts you shared, and follow-ups.</p></div>
      <Switch id="learn-from-calls" checked={learnFromCalls} onCheckedChange={(value) => { localStorage.setItem(MEMORY_FROM_CALLS_KEY, String(value)); setLearnFromCalls(value); }} />
    </div>

    <div className="rounded-xl border p-4 space-y-3">
      <h2 className="font-medium flex items-center gap-2"><Search className="size-4" />Test recall</h2>
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void run(async () => { setProbeHits(await recall(probe, 8)); }); }}>
        <Input aria-label="Test question" placeholder="Ask the way someone on a call would, e.g. What were the weaknesses of your study?" value={probe} onChange={(e) => { setProbe(e.target.value); setProbeHits(null); }} />
        <Button type="submit" variant="outline" disabled={busy || !probe.trim()}>Recall</Button>
      </form>
      {probeHits && (probeHits.length ? <ol className="space-y-2">{probeHits.map((hit) => <li key={hit.id} className="rounded-lg border p-3 text-sm space-y-1">
        <p className="text-xs text-muted-foreground">{hit.kind === "memory" ? `Memory · ${LAYER_LABEL[hit.layer ?? "shared"]}` : `Library · ${hit.title}`} · matched by {[hit.lexical && "keyword", (hit.relevance ?? 0) >= 2 && "meaning"].filter(Boolean).join(" + ") || "weak match"}</p>
        <p className="whitespace-pre-wrap break-words line-clamp-4">{hit.text}</p>
      </li>)}</ol> : <p className="text-sm text-muted-foreground">Nothing relevant enough was found. Veil would answer without personal context.</p>)}
    </div>

    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "core", "shared", "call"] as const).map((value) => <Button key={value} size="sm" variant={filter === value ? "default" : "outline"} onClick={() => setFilter(value)}>{value === "all" ? "All" : LAYER_LABEL[value]} ({counts[value]})</Button>)}
        <Input aria-label="Search memories" placeholder="Search memories…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs ml-auto" />
      </div>
      {coreChars > 1500 && <p className="text-xs text-amber-600">Core memories total {coreChars.toLocaleString()} characters; only the newest ~1,500 are included in every answer. Move older ones to Shared so they are recalled when relevant.</p>}
      {filter === "call" && counts.call > 0 && (confirm === "calls"
        ? <div className="flex gap-2"><Button size="sm" variant="destructive" disabled={busy} onClick={() => void run(async () => { await deleteMemories(items.filter((item) => item.layer === "call").map((item) => item.id)); setConfirm(""); })}>Delete all {counts.call} call memories</Button><Button size="sm" variant="outline" onClick={() => setConfirm("")}>Keep</Button></div>
        : <Button size="sm" variant="ghost" onClick={() => setConfirm("calls")}><Trash2 className="size-3.5" />Clear memories from calls</Button>)}
      {!shown.length ? <p className="rounded-xl border p-6 text-sm text-muted-foreground">{items.length ? "No memories match." : "No memories yet. Tell Veil something above, import a list, or finish a Listen session with Learn from calls on."}</p>
        : shown.map((item) => <article key={item.id} className={`rounded-xl border p-3 space-y-2 ${item.enabled ? "" : "opacity-60"}`}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-muted-foreground">{LAYER_LABEL[item.layer]} · {KIND_LABEL[item.kind]} · {originLabel(item)} · {new Date(item.updated_at).toLocaleDateString()}</p>
            <Switch aria-label="Use this memory" checked={item.enabled} disabled={busy} onCheckedChange={(value) => void run(async () => { await saveMemories([{ id: item.id, layer: item.layer, kind: item.kind, text: item.text, enabled: value }], false); })} />
          </div>
          {editing?.id === item.id
            ? <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void run(async () => { await saveMemories([{ id: item.id, layer: item.layer, kind: item.kind, text: editing.text }], false); setEditing(null); }); }}>
                <Textarea aria-label="Edit memory" value={editing.text} onChange={(e) => setEditing({ id: item.id, text: e.target.value })} className="min-h-20" maxLength={2000} />
                <div className="flex gap-2"><Button size="sm" type="submit" disabled={busy || !editing.text.trim()}>Save</Button><Button size="sm" type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button></div>
              </form>
            : <p className="text-sm whitespace-pre-wrap break-words">{item.text}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { await saveMemories([{ id: item.id, layer: item.layer === "core" ? "shared" : "core", kind: item.kind, text: item.text }], false); })}>{item.layer === "core" ? <><PinOff className="size-3.5" />Move to shared</> : <><Pin className="size-3.5" />Make core</>}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing({ id: item.id, text: item.text })}><Pencil className="size-3.5" />Edit</Button>
            {confirm === item.id
              ? <><Button size="sm" variant="destructive" disabled={busy} onClick={() => void run(async () => { await deleteMemories([item.id]); setConfirm(""); })}>Forget permanently</Button><Button size="sm" variant="outline" onClick={() => setConfirm("")}>Keep</Button></>
              : <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(item.id)}><Trash2 className="size-3.5" />Forget</Button>}
          </div>
        </article>)}
    </div>
  </div>;
}
