import { useEffect, useState } from "react";
import { Button, Input, Label, Switch, Textarea } from "@/components";
import { EMPTY_PREPARATION, PREPARATION_LIMITS, loadPreparation, savePreparation, type KnowledgePreparation, type PreparationField } from "@/lib/knowledge";

export function Preparation({ enabled }: { enabled: boolean }) {
  const [draft, setDraft] = useState<KnowledgePreparation>({ ...EMPTY_PREPARATION });
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    let alive = true;
    loadPreparation().then((value) => { if (alive) { setDraft(value); setLoaded(true); } })
      .catch(() => { if (alive) setError("Could not load your background. Reopen this page before editing it."); });
    return () => { alive = false; };
  }, []);
  const update = <K extends keyof KnowledgePreparation>(field: K, value: KnowledgePreparation[K]) => {
    setDraft((current) => ({ ...current, [field]: value })); setDirty(true); setSaved("");
  };
  const field = (name: PreparationField, label: string, placeholder: string, multiline = false) => {
    const props = { id: `prep-${name}`, value: draft[name], placeholder, maxLength: PREPARATION_LIMITS[name], disabled: !loaded || busy,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(name, event.target.value) };
    return <div className="space-y-1.5" key={name}>
      <Label htmlFor={props.id}>{label}</Label>
      {multiline ? <Textarea {...props} className="min-h-28" /> : <Input {...props} />}
      <p className="text-xs text-muted-foreground text-right">{draft[name].length}/{PREPARATION_LIMITS[name]}</p>
    </div>;
  };
  return <form className="space-y-5" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try { const value = await savePreparation(draft); setDraft(value); setDirty(false); setSaved("Saved. Ready for your next Listen session and new Ask answers."); }
    catch { setError("Could not save your background. Your edits are still here; please try again."); }
    finally { setBusy(false); }
  }}>
    <p className="text-sm text-muted-foreground">Tell Veil who you are and what this conversation is about. These details are included with answers, without needing a matching search term.</p>
    {!enabled && <p role="status" className="rounded-lg border p-3 text-sm">Personal knowledge is off. You can prepare here, but Veil will not use it until you turn it on above.</p>}
    <section className="rounded-xl border p-4 space-y-3">
      <div className="flex justify-between items-center gap-3"><h2 className="font-medium">About you</h2><Switch aria-label="Include About you" checked={draft.useProfile} disabled={!loaded || busy} onCheckedChange={(value) => update("useProfile", value)} /></div>
      <p className="text-xs text-muted-foreground">Your role, experience, projects and preferences. Only add facts you want Veil to use.</p>
      {field("aboutYou", "Your background", "For example: I’m a software developer working on… My experience includes…", true)}
      {field("answerStyle", "How answers should sound", "For example: conversational, explain the trade-off, use examples from my projects.")}
    </section>
    <section className="rounded-xl border p-4 space-y-3">
      <div className="flex justify-between items-center gap-3"><h2 className="font-medium">Session brief</h2><Switch aria-label="Include session brief" checked={draft.useBrief} disabled={!loaded || busy} onCheckedChange={(value) => update("useBrief", value)} /></div>
      <p className="text-xs text-muted-foreground">Set this before you start Listen. It stays saved until you change or clear it. An active call keeps the version it started with.</p>
      {field("sessionTitle", "Conversation name", "Project review, interview, study session…")}
      {field("objective", "What you want to achieve", "What should Veil help you communicate or decide?")}
      {field("audience", "Who you’re speaking with", "Their role, familiarity with the topic, expectations…")}
      {field("brief", "What Veil should know beforehand", "Paste context, constraints, relevant facts or questions you expect…", true)}
      <Button type="button" variant="outline" disabled={!loaded || busy} onClick={() => {
        setDraft((current) => ({ ...current, sessionTitle: "", objective: "", audience: "", brief: "" })); setDirty(true); setSaved("");
      }}>Clear session brief</Button>
    </section>
    <div className="sticky bottom-0 rounded-xl border bg-background p-3 space-y-2">
      <div className="flex items-center gap-3"><Button type="submit" disabled={!loaded || busy || !dirty}>{busy ? "Saving…" : "Save background"}</Button><span role="status" className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : saved || (draft.updatedAt ? `Saved ${new Date(draft.updatedAt).toLocaleString()}` : "Nothing saved yet")}</span></div>
      <p className="text-xs text-muted-foreground">Stored on this device. Included context is sent to your configured answer provider when you ask for an answer. Turn personal knowledge off to exclude it, including during an active call.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  </form>;
}
