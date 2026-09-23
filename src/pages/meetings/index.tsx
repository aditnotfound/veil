import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Input,
  Label,
  Markdown,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@/components";
import { PageLayout } from "@/layouts";
import { useApp } from "@/contexts";
import {
  createMeeting,
  deleteMeeting,
  fetchAIResponse,
  listMeetings,
  safeLocalStorage,
  shouldUsePluelyAPI,
  updateMeeting,
  type Meeting,
} from "@/lib";
import { DEFAULT_SYSTEM_PROMPT } from "@/config";
import {
  ArrowLeft,
  CalendarDays,
  Download,
  Loader2,
  PlusIcon,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import moment from "moment";
import { correctCallUtterance, deleteAllCallSessions, deleteCallSession, getCallSessionLedger, getCallSessionPlans, getCallSuggestions, getCallUtteranceRevisions, getCallUtterances, listCallSessions, pruneCallSessionsOlderThan, restoreCallUtteranceRevision, type CallUtteranceRevision, type StoredCallSession } from "@/lib/database/call-session.action";
import { saveRegeneratedCallAnswerCard, saveRegeneratedCallDeepAnswer } from "@/lib/database/call-answer-card.action";
import { buildCallReviewHistory, buildDeepCallReviewHistory, formatCallLedger, formatCallPlans, formatCallSuggestions, type StoredCallSuggestion } from "@/lib/call/session-review";
import { callCardPrompt, deepCallPrompt } from "@/lib/call/decision-router";
import { selectedModelName, withModelOverride } from "@/lib/call/deep-provider";
import type { AnswerStreamEvent } from "@/lib/call/answer-card";
import type { Message } from "@/types/completion";
import type { FinalUtterance } from "@/lib/call/session-core";
import {
  CALL_RETENTION_OPTIONS,
  CALL_RETENTION_STORAGE_KEY,
  callRetentionCutoff,
  callRetentionLabel,
  parseCallRetentionDays,
  type CallRetentionDays,
} from "@/lib/call/retention";

function formatCallTranscript(utterances: FinalUtterance[]): string {
  return utterances.map((utterance) =>
    `[${moment(utterance.startedAt).format("h:mm:ss A")}] ${utterance.source === "mic" ? "Mic" : "System"}: ${utterance.text}`
  ).join("\n");
}

const Meetings = () => {
  const { selectedAIProvider, allAiProviders, systemPrompt } = useApp();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [callSessions, setCallSessions] = useState<StoredCallSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [deletingCallSessionId, setDeletingCallSessionId] = useState<string | null>(null);
  const [isClearingCallData, setIsClearingCallData] = useState(false);
  const [retentionDays, setRetentionDays] = useState<CallRetentionDays>(() =>
    parseCallRetentionDays(safeLocalStorage.getItem(CALL_RETENTION_STORAGE_KEY))
  );
  const [retentionStatus, setRetentionStatus] = useState("");

  const [formTitle, setFormTitle] = useState("");
  const [formTranscript, setFormTranscript] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formSummary, setFormSummary] = useState("");
  const [formSuggestions, setFormSuggestions] = useState("");
  const [formLedger, setFormLedger] = useState("");
  const [formPlans, setFormPlans] = useState("");
  const [sourceCallSessionId, setSourceCallSessionId] = useState<string | null>(null);
  const [sourceUtterances, setSourceUtterances] = useState<FinalUtterance[]>([]);
  const [sourceSuggestions, setSourceSuggestions] = useState<StoredCallSuggestion[]>([]);
  const [sourceRevisions, setSourceRevisions] = useState<CallUtteranceRevision[]>([]);
  const [correctionDrafts, setCorrectionDrafts] = useState<Record<string, string>>({});
  const [savingCorrectionId, setSavingCorrectionId] = useState<string | null>(null);
  const [restoringRevisionId, setRestoringRevisionId] = useState<number | null>(null);
  const [regeneratingSuggestionKey, setRegeneratingSuggestionKey] = useState<string | null>(null);
  const [regenerationPreview, setRegenerationPreview] = useState("");

  const abortRef = useRef<AbortController | null>(null);

  const selected = meetings.find((m) => m.id === selectedId) || null;

  const loadMeetings = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const cutoff = callRetentionCutoff(retentionDays);
      if (cutoff !== null) await pruneCallSessionsOlderThan(cutoff);
      const list = await listMeetings();
      setMeetings(list);
      setCallSessions(await listCallSessions());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load meetings"
      );
    } finally {
      setIsLoading(false);
    }
  }, [retentionDays]);

  useEffect(() => {
    loadMeetings();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadMeetings]);

  useEffect(() => {
    if (selected) {
      setFormTitle(selected.title);
      setFormTranscript(selected.transcript);
      setFormNotes(selected.notes);
      setFormSummary(selected.summary);
      setFormSuggestions("");
      setFormLedger("");
      setFormPlans("");
      setSourceCallSessionId(null);
      setSourceUtterances([]);
      setSourceSuggestions([]);
      setSourceRevisions([]);
      setCorrectionDrafts({});
      setRegenerationPreview("");
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps -- sync form when selection changes

  const openNewMeeting = () => {
    setSelectedId(null);
    setIsCreating(true);
    setFormTitle("");
    setFormTranscript("");
    setFormNotes("");
    setFormSummary("");
    setFormSuggestions("");
    setFormLedger("");
    setFormPlans("");
    setSourceCallSessionId(null);
    setSourceUtterances([]);
    setSourceSuggestions([]);
    setSourceRevisions([]);
    setCorrectionDrafts({});
    setRegenerationPreview("");
    setError(null);
  };

  const openMeeting = (id: string) => {
    setIsCreating(false);
    setSelectedId(id);
    setFormSuggestions("");
    setFormLedger("");
    setFormPlans("");
    setSourceCallSessionId(null);
    setSourceUtterances([]);
    setSourceSuggestions([]);
    setSourceRevisions([]);
    setCorrectionDrafts({});
    setRegenerationPreview("");
    setError(null);
  };

  const backToList = () => {
    abortRef.current?.abort();
    setIsSummarizing(false);
    setSelectedId(null);
    setIsCreating(false);
    setFormSuggestions("");
    setFormLedger("");
    setFormPlans("");
    setSourceCallSessionId(null);
    setSourceUtterances([]);
    setSourceSuggestions([]);
    setSourceRevisions([]);
    setCorrectionDrafts({});
    setRegenerationPreview("");
    setError(null);
  };

  const handleCreate = async () => {
    try {
      setIsSaving(true);
      setError(null);
      const created = await createMeeting({
        title: formTitle.trim() || "Untitled meeting",
        transcript: formTranscript,
        notes: formNotes,
        summary: formSummary,
      });
      setMeetings((prev) => [created, ...prev]);
      setIsCreating(false);
      setSelectedId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create meeting");
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenCallSession = async (session: StoredCallSession) => {
    try {
      setError(null);
      const [utterances, suggestions, ledger, plans, revisions] = await Promise.all([
        getCallUtterances(session.id),
        getCallSuggestions(session.id),
        getCallSessionLedger(session.id),
        getCallSessionPlans(session.id),
        getCallUtteranceRevisions(session.id),
      ]);
      setSelectedId(null);
      setIsCreating(true);
      setFormTitle(`Listen session — ${moment(session.started_at).format("MMM D, YYYY h:mm A")}`);
      setFormTranscript(formatCallTranscript(utterances));
      setFormNotes("");
      setFormSummary("");
      setFormSuggestions(formatCallSuggestions(
        suggestions,
        (timestamp) => moment(timestamp).format("h:mm:ss A")
      ));
      setFormLedger(formatCallLedger(
        ledger,
        (timestamp) => moment(timestamp).format("h:mm:ss A")
      ));
      setFormPlans(formatCallPlans(
        plans,
        (timestamp) => moment(timestamp).format("h:mm:ss A")
      ));
      setSourceCallSessionId(session.id);
      setSourceUtterances(utterances);
      setSourceSuggestions(suggestions);
      setSourceRevisions(revisions);
      setCorrectionDrafts(Object.fromEntries(utterances.map((item) => [item.id, item.text])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open Listen session");
    }
  };

  const handleDeleteCallSession = async (session: StoredCallSession) => {
    if (!window.confirm("Permanently delete this Listen session, transcript, candidate memory, saved cards, and deep drafts? Any meeting saved from it remains separate.")) return;
    try {
      setDeletingCallSessionId(session.id);
      setError(null);
      await deleteCallSession(session.id);
      setCallSessions((prev) => prev.filter((item) => item.id !== session.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete Listen session");
    } finally {
      setDeletingCallSessionId(null);
    }
  };

  const handleRetentionChange = (value: string) => {
    const next = parseCallRetentionDays(value);
    safeLocalStorage.setItem(CALL_RETENTION_STORAGE_KEY, String(next));
    setRetentionDays(next);
    setRetentionStatus(
      next === 0
        ? "Future Listen sessions stay local until you delete them."
        : `Listen sessions older than ${next} days will be deleted locally.`
    );
  };

  const handleDeleteAllCallSessions = async () => {
    if (!window.confirm(
      "Permanently delete every Listen session, transcript, candidate memory, saved card, and deep draft? Saved meeting copies remain separate."
    )) return;
    try {
      setIsClearingCallData(true);
      setError(null);
      const deleted = await deleteAllCallSessions();
      setCallSessions([]);
      if (sourceCallSessionId) backToList();
      setRetentionStatus(`Deleted ${deleted} local Listen session${deleted === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete Listen data");
    } finally {
      setIsClearingCallData(false);
    }
  };

  const refreshCorrectedCallSession = async (
    sessionId: string,
    corrected: FinalUtterance,
    ledgerRebuilt: boolean
  ) => {
    const nextUtterances = sourceUtterances.map((item) =>
      item.id === corrected.id ? corrected : item
    );
    const [suggestions, ledger, plans, revisions] = await Promise.all([
      getCallSuggestions(sessionId),
      getCallSessionLedger(sessionId),
      getCallSessionPlans(sessionId),
      getCallUtteranceRevisions(sessionId),
    ]);
    setSourceUtterances(nextUtterances);
    setSourceSuggestions(suggestions);
    setSourceRevisions(revisions);
    setCorrectionDrafts((previous) => ({ ...previous, [corrected.id]: corrected.text }));
    setFormTranscript(formatCallTranscript(nextUtterances));
    setFormSuggestions(formatCallSuggestions(suggestions, (timestamp) => moment(timestamp).format("h:mm:ss A")));
    setFormLedger(formatCallLedger(ledger, (timestamp) => moment(timestamp).format("h:mm:ss A")));
    setFormPlans(formatCallPlans(plans, (timestamp) => moment(timestamp).format("h:mm:ss A")));
    if (!ledgerRebuilt) {
      setError("Transcript changed, but its candidate session memory could not be rebuilt.");
    }
  };

  const handleCorrectUtterance = async (utteranceId: string) => {
    if (!sourceCallSessionId) return;
    const text = correctionDrafts[utteranceId] ?? "";
    try {
      setSavingCorrectionId(utteranceId);
      setError(null);
      const correction = await correctCallUtterance(sourceCallSessionId, utteranceId, text);
      await refreshCorrectedCallSession(
        sourceCallSessionId,
        correction.utterance,
        correction.ledgerRebuilt
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to correct transcript source");
    } finally {
      setSavingCorrectionId(null);
    }
  };

  const handleRestoreRevision = async (revision: CallUtteranceRevision) => {
    if (!sourceCallSessionId) return;
    try {
      setRestoringRevisionId(revision.id);
      setError(null);
      const correction = await restoreCallUtteranceRevision(
        sourceCallSessionId,
        revision.id
      );
      await refreshCorrectedCallSession(
        sourceCallSessionId,
        correction.utterance,
        correction.ledgerRebuilt
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore transcript revision");
    } finally {
      setRestoringRevisionId(null);
    }
  };

  const handleRegenerateSuggestion = async (suggestion: StoredCallSuggestion) => {
    if (!sourceCallSessionId || suggestion.status !== "stale") return;
    const turn = sourceUtterances.find((utterance) => utterance.id === suggestion.turnId);
    if (!turn) {
      setError("The corrected source turn is no longer available.");
      return;
    }
    const initial = sourceSuggestions.find((item) =>
      item.turnId === suggestion.turnId && item.tier === "initial"
    );
    if (suggestion.tier === "deep" && (!initial || initial.status === "stale")) {
      setError("Regenerate the stale initial card before regenerating its deep draft.");
      return;
    }
    const suggestionKey = `${suggestion.tier}:${suggestion.turnId}`;
    try {
      setRegeneratingSuggestionKey(suggestionKey);
      setRegenerationPreview("");
      setError(null);
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const usePluelyAPI = await shouldUsePluelyAPI();
      const provider = allAiProviders.find((item) => item.id === selectedAIProvider.provider);
      if (!usePluelyAPI && !provider) throw new Error("Select an AI provider before regenerating this card.");
      const deepSelectedProvider = withModelOverride(
        selectedAIProvider,
        suggestion.tier === "deep"
          ? safeLocalStorage.getItem("call_deep_model_override") ?? ""
          : ""
      );
      const history: Message[] = suggestion.tier === "deep" && initial
        ? buildDeepCallReviewHistory(sourceUtterances, suggestion.turnId, initial.answer)
        : buildCallReviewHistory(sourceUtterances, suggestion.turnId);
      const startedAt = Date.now();
      const streamEvents: AnswerStreamEvent[] = [];
      let answer = "";
      for await (const chunk of fetchAIResponse({
        provider: usePluelyAPI ? undefined : provider,
        selectedProvider: deepSelectedProvider,
        systemPrompt: suggestion.tier === "deep"
          ? deepCallPrompt(systemPrompt || DEFAULT_SYSTEM_PROMPT)
          : callCardPrompt(systemPrompt || DEFAULT_SYSTEM_PROMPT),
        history,
        historyOrder: "chronological",
        knowledgeMode: "local",
        responseProfile: suggestion.tier === "deep" ? "deep" : "default",
        userMessage: turn.text,
        imagesBase64: [],
        signal: abortRef.current.signal,
      })) {
        if (chunk) streamEvents.push({ at: Date.now(), delta: chunk });
        answer += chunk;
        setRegenerationPreview(answer);
      }
      if (!answer.trim()) throw new Error("The provider returned no replacement answer.");
      const replacement = {
        turnId: suggestion.turnId,
        sessionId: sourceCallSessionId,
        provider: usePluelyAPI ? "pluely-managed" : selectedAIProvider.provider,
        model: selectedModelName(deepSelectedProvider),
        answerText: answer,
        streamEvents,
        startedAt,
        completedAt: Date.now(),
      };
      const saved = suggestion.tier === "deep"
        ? await saveRegeneratedCallDeepAnswer(replacement, turn.text)
        : await saveRegeneratedCallAnswerCard(replacement, turn.text);
      if (!saved) throw new Error("The transcript changed while this answer was regenerating. Review it and try again.");
      const suggestions = await getCallSuggestions(sourceCallSessionId);
      setSourceSuggestions(suggestions);
      setFormSuggestions(formatCallSuggestions(suggestions, (timestamp) => moment(timestamp).format("h:mm:ss A")));
      setRegenerationPreview("");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to regenerate the saved card");
    } finally {
      setRegeneratingSuggestionKey(null);
    }
  };

  const handleSave = async () => {
    if (!selectedId) return;
    try {
      setIsSaving(true);
      setError(null);
      const updated = await updateMeeting(selectedId, {
        title: formTitle,
        transcript: formTranscript,
        notes: formNotes,
        summary: formSummary,
      });
      setMeetings((prev) =>
        prev.map((m) => (m.id === updated.id ? updated : m))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save meeting");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setError(null);
      await deleteMeeting(id);
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      if (selectedId === id) backToList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete meeting");
    }
  };

  const handleGenerateSummary = async () => {
    if (!formTranscript.trim()) {
      setError("Add a transcript before generating a summary.");
      return;
    }

    const provider = allAiProviders.find(
      (p) => p.id === selectedAIProvider.provider
    );

    try {
      setIsSummarizing(true);
      setError(null);
      setFormSummary("");

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      let full = "";
      for await (const chunk of fetchAIResponse({
        provider,
        selectedProvider: selectedAIProvider,
        systemPrompt:
          systemPrompt ||
          "You summarize meeting transcripts clearly and concisely.",
        userMessage: `Summarize this meeting transcript. Include key topics, decisions, and action items.\n\n---\n${formTranscript}`,
        signal: abortRef.current.signal,
      })) {
        full += chunk;
        setFormSummary(full);
      }

      if (selectedId) {
        const updated = await updateMeeting(selectedId, { summary: full });
        setMeetings((prev) =>
          prev.map((m) => (m.id === updated.id ? updated : m))
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(
        err instanceof Error ? err.message : "Failed to generate summary"
      );
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleExport = () => {
    const title = formTitle.trim() || "meeting";
    const markdown = `# ${title}

## Transcript

${formTranscript || "_No transcript_"}

## Veil suggestions

${formSuggestions || "_No saved suggestions_"}

## Candidate session memory

${formLedger || "_No candidate session memory_"}

## Candidate asynchronous plans

${formPlans || "_No candidate asynchronous plans_"}

## Summary

${formSummary || "_No summary_"}

## Notes

${formNotes || "_No notes_"}
`;
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const safe = title.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 40) || "meeting";
    link.download = `${safe}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const showEditor = isCreating || !!selected;

  return (
    <PageLayout
      title="Meetings"
      description="Save Listen transcripts, generate summaries, and export notes."
      rightSlot={
        !showEditor ? (
          <Button variant="default" size="default" onClick={openNewMeeting}>
            <PlusIcon className="size-4" />
            New meeting
          </Button>
        ) : undefined
      }
    >
      {!showEditor && (
        <Card className="mb-4 gap-3 p-4 shadow-none">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor="call-retention">Local Listen data</Label>
              <p className="text-xs text-muted-foreground">
                Transcripts and answer records remain on this device. Uninstalling Veil does not remove its AppData database.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={String(retentionDays)} onValueChange={handleRetentionChange}>
                <SelectTrigger id="call-retention" className="w-44">
                  <SelectValue aria-label={callRetentionLabel(retentionDays)} />
                </SelectTrigger>
                <SelectContent>
                  {CALL_RETENTION_OPTIONS.map((days) => (
                    <SelectItem key={days} value={String(days)}>
                      {callRetentionLabel(days)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleDeleteAllCallSessions()}
                disabled={isClearingCallData}
              >
                {isClearingCallData && <Loader2 className="size-4 animate-spin" />}
                Clear all Listen data
              </Button>
            </div>
          </div>
          {retentionStatus && (
            <p className="text-xs text-muted-foreground" role="status">
              {retentionStatus}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Saved meeting copies are separate records and must be deleted separately.
          </p>
        </Card>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {showEditor ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={backToList}>
              <ArrowLeft className="size-4" />
              Back
            </Button>
            {!isCreating && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => selectedId && handleDelete(selectedId)}
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={!formTranscript && !formSummary}
            >
              <Download className="size-4" />
              Export .md
            </Button>
            <div className="flex-1" />
            {isCreating ? (
              <Button onClick={handleCreate} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Create
              </Button>
            ) : (
              <Button onClick={handleSave} disabled={isSaving || isSummarizing}>
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Save
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="meeting-title">Title</Label>
            <Input
              id="meeting-title"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="Meeting title"
              className="focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="meeting-transcript">Transcript</Label>
            <Textarea
              id="meeting-transcript"
              value={formTranscript}
              onChange={(e) => setFormTranscript(e.target.value)}
              placeholder="Paste a Listen session transcript here…"
              className="min-h-40"
              disabled={isSummarizing}
            />
          </div>

          {sourceCallSessionId && (
            <details className="rounded-lg border border-border/50 p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Correct source transcript ({sourceUtterances.length} utterances)
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">
                Corrections are audited. Saving one rebuilds its local memory candidates, removes session planner drafts, and marks answers at or after that turn stale.
              </p>
              <div className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-1">
                {sourceUtterances.map((utterance) => {
                  const draft = correctionDrafts[utterance.id] ?? utterance.text;
                  const changed = draft.replace(/\s+/g, " ").trim() !== utterance.text;
                  return (
                    <Card key={utterance.id} className="gap-2 p-3 shadow-none">
                      <p className="text-[11px] text-muted-foreground">
                        [C:{utterance.id}] · {moment(utterance.startedAt).format("h:mm:ss A")} · {utterance.source === "mic" ? "Mic" : "System"}
                      </p>
                      <Textarea
                        value={draft}
                        onChange={(event) => setCorrectionDrafts((previous) => ({
                          ...previous,
                          [utterance.id]: event.target.value,
                        }))}
                        className="min-h-20 text-xs"
                        disabled={savingCorrectionId === utterance.id}
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!changed || !draft.trim() || savingCorrectionId !== null}
                          onClick={() => void handleCorrectUtterance(utterance.id)}
                        >
                          {savingCorrectionId === utterance.id && <Loader2 className="size-4 animate-spin" />}
                          Save correction
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
              {sourceRevisions.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-border/50 pt-3">
                  <p className="text-xs font-medium">Revision history</p>
                  {sourceRevisions.map((revision) => {
                    const currentText = sourceUtterances.find(
                      (item) => item.id === revision.utteranceId
                    )?.text;
                    const alreadyCurrent = currentText?.replace(/\s+/g, " ").trim()
                      === revision.previousText.replace(/\s+/g, " ").trim();
                    return (
                      <div key={revision.id} className="flex items-start justify-between gap-2 rounded-md border border-border/40 p-2">
                        <p className="text-[11px] text-muted-foreground">
                          [C:{revision.utteranceId}] · {moment(revision.correctedAt).format("h:mm:ss A")} · “{revision.previousText}” → “{revision.correctedText}”
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 text-[11px]"
                          disabled={alreadyCurrent || savingCorrectionId !== null || restoringRevisionId !== null}
                          onClick={() => void handleRestoreRevision(revision)}
                        >
                          {restoringRevisionId === revision.id
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <RotateCcw className="size-3.5" />}
                          Restore previous
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </details>
          )}

          {formSuggestions && (
            <div className="space-y-2">
              <div>
                <Label>Saved Veil suggestions</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Generated text is shown separately from the transcript and your notes.
                </p>
              </div>
              <Card className="shadow-none p-4 prose prose-sm max-w-none dark:prose-invert">
                <Markdown>{formSuggestions}</Markdown>
              </Card>
              {sourceSuggestions.some((suggestion) => suggestion.status === "stale") && (
                <Card className="gap-3 p-3 shadow-none">
                  <div>
                    <p className="text-xs font-medium">Regenerate stale cards</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Replacements use the corrected transcript, bounded earlier call context, local knowledge retrieval, and the currently selected provider. Deep drafts use the configured call-only deep model override and require a current initial card.
                    </p>
                  </div>
                  {sourceSuggestions
                    .filter((suggestion) => suggestion.status === "stale")
                    .map((suggestion) => {
                      const suggestionKey = `${suggestion.tier}:${suggestion.turnId}`;
                      const currentInitial = sourceSuggestions.find((item) =>
                        item.turnId === suggestion.turnId && item.tier === "initial"
                      );
                      const waitingForInitial = suggestion.tier === "deep" &&
                        (!currentInitial || currentInitial.status === "stale");
                      return (
                        <div key={suggestionKey} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/40 p-2">
                          <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                            {suggestion.tier === "deep" ? "Deep draft" : "Initial card"} · [C:{suggestion.turnId}] {suggestion.prompt}
                            {waitingForInitial ? " · regenerate the initial card first" : ""}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={regeneratingSuggestionKey !== null || waitingForInitial}
                            onClick={() => void handleRegenerateSuggestion(suggestion)}
                          >
                            {regeneratingSuggestionKey === suggestionKey && <Loader2 className="size-3.5 animate-spin" />}
                            Regenerate {suggestion.tier === "deep" ? "deep draft" : "initial card"}
                          </Button>
                        </div>
                      );
                    })}
                  {regenerationPreview && (
                    <div className="rounded-md border border-border/40 p-3">
                      <p className="mb-2 text-[11px] font-medium text-muted-foreground">Replacement preview</p>
                      <Markdown isStreaming>{regenerationPreview}</Markdown>
                    </div>
                  )}
                </Card>
              )}
            </div>
          )}

          {formLedger && (
            <div className="space-y-2">
              <div>
                <Label>Candidate session memory</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Exact transcript excerpts selected locally. Labels are hints and do not verify that an excerpt is true or current.
                </p>
              </div>
              <Card className="shadow-none p-4 prose prose-sm max-w-none dark:prose-invert">
                <Markdown>{formLedger}</Markdown>
              </Card>
            </div>
          )}

          {formPlans && (
            <div className="space-y-2">
              <div>
                <Label>Candidate asynchronous plans</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Model-generated navigation drafts. They are unverified and shown with the transcript sources they cited.
                </p>
              </div>
              <Card className="shadow-none p-4 prose prose-sm max-w-none dark:prose-invert">
                <Markdown>{formPlans}</Markdown>
              </Card>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="meeting-summary">Summary</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGenerateSummary}
                disabled={isSummarizing || !formTranscript.trim()}
              >
                {isSummarizing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Generate summary
              </Button>
            </div>
            <Textarea
              id="meeting-summary"
              value={formSummary}
              onChange={(e) => setFormSummary(e.target.value)}
              placeholder="AI summary will stream here…"
              className="min-h-32"
              disabled={isSummarizing}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="meeting-notes">Notes</Label>
            <Textarea
              id="meeting-notes"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Your private notes…"
              className="min-h-28"
            />
          </div>
        </div>
      ) : meetings.length === 0 && callSessions.length === 0 ? (
        <Empty
          isLoading={isLoading}
          icon={CalendarDays}
          title="No meetings yet"
          description="Create a meeting or start a Listen session to get started"
        />
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {callSessions.length > 0 && (
            <>
              <p className="text-xs font-medium text-muted-foreground">Listen sessions</p>
              {callSessions.map((session) => (
                <Card
                  key={session.id}
                  className="shadow-none p-4 gap-0 cursor-pointer transition-all hover:!border-primary/50"
                  onClick={() => handleOpenCallSession(session)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {moment(session.started_at).format("MMM D, YYYY h:mm A")}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {session.utterance_count} utterances · {session.ledger_count} memory candidates · {session.planner_count} plans · {session.answer_count} cards · {session.deep_answer_count} deep drafts
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      disabled={deletingCallSessionId === session.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteCallSession(session);
                      }}
                      title="Delete Listen session"
                      aria-label={`Delete Listen session from ${moment(session.started_at).format("MMM D, YYYY h:mm A")}`}
                    >
                      {deletingCallSessionId === session.id
                        ? <Loader2 className="size-4 animate-spin" />
                        : <Trash2 className="size-4 text-muted-foreground" />}
                    </Button>
                  </div>
                </Card>
              ))}
            </>
          )}
          {meetings.length > 0 && (
            <p className="text-xs font-medium text-muted-foreground">Saved meetings</p>
          )}
          {meetings.map((meeting) => (
            <Card
              key={meeting.id}
              className="shadow-none select-none p-4 gap-0 group relative transition-all !bg-black/5 dark:!bg-white/5 hover:!border-primary/50 cursor-pointer"
              onClick={() => openMeeting(meeting.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm font-medium">
                    {meeting.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                    {meeting.summary ||
                      meeting.transcript.slice(0, 120) ||
                      "No transcript"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {moment(meeting.updated_at).format("MMM D, h:mm A")}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(meeting.id);
                    }}
                    title="Delete meeting"
                    aria-label={`Delete ${meeting.title}`}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </PageLayout>
  );
};

export default Meetings;
