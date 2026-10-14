import { useCallback, useEffect, useState } from "react";
import { Button, Input, Label, Switch, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from "@/components";
import { PageLayout } from "@/layouts";
import { useApp } from "@/contexts";
import { deleteKnowledgeSource, extractTextFromFile, getKnowledgeSettings, ingestKnowledgeSource, listKnowledgeSources, setKnowledgeEnabled, setKnowledgeFocusTags, setKnowledgeSourceFlag, loadPreparation, formatPreparation, retrievePersonalContextLocal, type KnowledgeSource } from "@/lib/knowledge";
import { Pin, Pencil, Trash2, Upload } from "lucide-react";
import { Interview } from "./Interview";
import { Preparation } from "./Preparation";

const parseTags = (value: string) => [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];

export default function Knowledge() {
  const { selectedAIProvider } = useApp();
  const apiKey = selectedAIProvider?.provider === "openai" ? (selectedAIProvider.variables?.api_key || selectedAIProvider.variables?.API_KEY || "").trim() : "";
  const [enabled, setEnabled] = useState(() => getKnowledgeSettings().enabled);
  const [focusTags, setFocusTags] = useState(() => getKnowledgeSettings().focusTags.join(", "));
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<KnowledgeSource | null>(null);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [semantic, setSemantic] = useState(false);
  const [question, setQuestion] = useState("");
  const [preview, setPreview] = useState("");
  const load = useCallback(async () => {
    try { setSources(await listKnowledgeSources()); }
    catch { setError("Could not load your sources. Please reopen this page."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => { void load(); setEnabled(getKnowledgeSettings().enabled); setPreview(""); };
    window.addEventListener("knowledge-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("knowledge-changed", refresh); window.removeEventListener("storage", refresh); };
  }, [load]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const resetEditor = () => { setEditing(null); setTitle(""); setTags(""); setBody(""); };
  const filtered = sources.filter((source) => `${source.title} ${source.tags.join(" ")} ${source.raw_text}`.toLowerCase().includes(search.toLowerCase()));
  return <PageLayout title="Knowledge" description="Your background, your references, and the context for your next conversation.">
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
        <div><Label htmlFor="knowledge-enabled">Use personal knowledge</Label><p className="text-xs text-muted-foreground mt-1">{enabled ? "Background and included sources can help with answers." : "Off for all new answers. Your saved information stays on this device."}</p></div>
        <Switch id="knowledge-enabled" checked={enabled} onCheckedChange={(value) => { setKnowledgeEnabled(value); setEnabled(value); }} />
      </div>
      {error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      <Tabs defaultValue="prepare" className="gap-4" onValueChange={() => void load()}>
        <TabsList className="flex flex-wrap h-auto justify-start">
          <TabsTrigger value="prepare">Prepare</TabsTrigger><TabsTrigger value="library">Library ({sources.length})</TabsTrigger><TabsTrigger value="preview">Check context</TabsTrigger><TabsTrigger value="interview">Profile interview</TabsTrigger>
        </TabsList>
        <TabsContent value="prepare" forceMount className="data-[state=inactive]:hidden"><Preparation enabled={enabled} /></TabsContent>
        <TabsContent value="library" forceMount className="space-y-4 data-[state=inactive]:hidden">
          <p className="text-sm text-muted-foreground">Add reference notes or files. Pin up to three short sources to include their opening excerpt even when a question uses different wording. Other included sources are searched when needed.</p>
          <form className="rounded-xl border p-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void run(async () => {
            await ingestKnowledgeSource({ title: title.trim() || "Untitled note", kind: editing?.kind ?? "note", text: body, tags: parseTags(tags), existingId: editing?.id, apiKey: semantic ? apiKey : "" });
            resetEditor(); await load(); setNotice("Source saved and ready for local search.");
          }); }}>
            <h2 className="font-medium">{editing ? `Edit: ${editing.title}` : "Add a reference"}</h2>
            <Input aria-label="Reference title" placeholder="Title — project notes, resume, key facts…" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} maxLength={200} />
            <Input aria-label="Reference tags" placeholder="Tags, separated by commas" value={tags} onChange={(e) => setTags(e.target.value)} disabled={busy} />
            <Textarea aria-label="Reference text" placeholder="Paste the information Veil should be able to refer to…" className="min-h-36" value={body} onChange={(e) => setBody(e.target.value)} disabled={busy} required />
            {apiKey && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={semantic} onChange={(e) => setSemantic(e.target.checked)} disabled={busy} />Also send this source to OpenAI to build semantic search for Ask</label>}
            <p className="text-xs text-muted-foreground">Saving uses local search by default. Relevant excerpts are sent to your answer provider when answering. Updating a source rebuilds its search index.</p>
            <div className="flex flex-wrap gap-2 items-center">
              <Button type="submit" disabled={busy || !body.trim()}>{busy ? "Working…" : editing ? "Save changes" : "Save reference"}</Button>
              {editing && <Button type="button" variant="outline" disabled={busy} onClick={resetEditor}>Cancel edit</Button>}
              {!editing && <><Label htmlFor="knowledge-upload" className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}><Upload className="size-4" />Import text file</Label>
                <input id="knowledge-upload" type="file" className="hidden" accept=".txt,.md,.csv,.json" disabled={busy} onChange={(event) => {
                  const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
                  void run(async () => {
                    if (file.size > 2 * 1024 * 1024) throw new Error("Choose a text file smaller than 2 MB, or paste the relevant section.");
                    await ingestKnowledgeSource({ title: file.name, kind: "file", text: await extractTextFromFile(file), tags: parseTags(tags), apiKey: semantic ? apiKey : "" });
                    await load(); setNotice("File imported. You can edit, pin, or exclude it below.");
                  });
                }} /><span className="text-xs text-muted-foreground">TXT, Markdown, CSV, JSON. Paste text from PDFs.</span></>}
            </div>
          </form>
          <div className="space-y-2"><Label htmlFor="focus-tags">Prefer these tags when searching</Label><Input id="focus-tags" value={focusTags} placeholder="work, project-x" onChange={(e) => setFocusTags(e.target.value)} onBlur={() => { const parsed = parseTags(focusTags); setKnowledgeFocusTags(parsed); setFocusTags(parsed.join(", ")); }} /></div>
          <Input aria-label="Search saved references" placeholder="Search your references…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <p className="text-xs text-muted-foreground">{sources.filter((s) => s.enabled).length} included · {sources.filter((s) => s.pinned).length}/3 pinned · {filtered.length} shown</p>
          {loading ? <p>Loading references…</p> : !filtered.length ? <p className="rounded-xl border p-6 text-sm text-muted-foreground">{sources.length ? "No references match your search." : "No references yet. Add notes above or build your profile with the interview."}</p> : filtered.map((source) => <article key={source.id} className={`rounded-xl border p-4 space-y-3 ${source.enabled ? "" : "opacity-70"}`}>
            <div className="flex justify-between gap-3 items-start"><div className="min-w-0"><h3 className="font-medium break-words">{source.pinned && <Pin className="inline size-3.5 mr-1" />}{source.title}</h3><p className="text-xs text-muted-foreground">{source.tags.join(" · ")} · Updated {new Date(source.updated_at).toLocaleDateString()} · {source.enabled ? "Included" : "Excluded"}</p></div>
              <Switch aria-label={`Include ${source.title}`} checked={source.enabled} disabled={busy} onCheckedChange={(value) => void run(async () => { await setKnowledgeSourceFlag(source.id, "enabled", value); await load(); })} />
            </div>
            <details><summary className="cursor-pointer text-xs text-muted-foreground">Read source · {source.raw_text.length.toLocaleString()} characters</summary><p className="mt-2 text-sm whitespace-pre-wrap max-h-60 overflow-auto break-words">{source.raw_text}</p></details>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { await setKnowledgeSourceFlag(source.id, "pinned", !source.pinned); await load(); })}><Pin className="size-3.5" />{source.pinned ? "Unpin" : "Pin"}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { setEditing(source); setTitle(source.title); setBody(source.raw_text); setTags(source.tags.join(", ")); document.querySelector('input[aria-label="Reference title"]')?.scrollIntoView({ behavior: "smooth", block: "center" }); }}><Pencil className="size-3.5" />Edit</Button>
              {confirmDelete === source.id ? <><Button size="sm" variant="destructive" disabled={busy} onClick={() => void run(async () => { await deleteKnowledgeSource(source.id); if (editing?.id === source.id) resetEditor(); setConfirmDelete(""); await load(); })}>Delete permanently</Button><Button size="sm" variant="outline" onClick={() => setConfirmDelete("")}>Keep</Button></> : <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(source.id)} aria-label={`Delete ${source.title}`}><Trash2 className="size-3.5" />Delete</Button>}
            </div>
          </article>)}
        </TabsContent>
        <TabsContent value="preview" className="space-y-3">
          <h2 className="font-medium">See what Veil would know</h2><p className="text-sm text-muted-foreground">Check your saved background, pinned excerpts and local search matches for a sample question. This does not send a request to an AI provider. Ask’s optional semantic search can return different references.</p>
          <Input aria-label="Sample question" placeholder="For example: Tell me about my latest project" value={question} onChange={(e) => { setQuestion(e.target.value); setPreview(""); }} />
          <Button disabled={busy} onClick={() => void run(async () => {
            const settings = getKnowledgeSettings();
            const [prep, refs] = await Promise.all([loadPreparation(), retrievePersonalContextLocal({ query: question })]);
            setPreview(!settings.enabled ? "Personal knowledge is off. No saved background or library excerpts will be included." : [formatPreparation(prep), refs].filter(Boolean).join("\n\n") || "No saved background or matching references. Add context in Prepare, or save a reference in Library.");
          })}>Check saved context</Button>
          {preview && <pre className="rounded-xl border p-4 text-xs whitespace-pre-wrap break-words max-h-[32rem] overflow-auto" role="status">{preview}</pre>}
        </TabsContent>
        <TabsContent value="interview"><Interview /></TabsContent>
      </Tabs>
    </div>
  </PageLayout>;
}
