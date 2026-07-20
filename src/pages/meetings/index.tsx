import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Input,
  Label,
  Textarea,
} from "@/components";
import { PageLayout } from "@/layouts";
import { useApp } from "@/contexts";
import {
  createMeeting,
  deleteMeeting,
  fetchAIResponse,
  listMeetings,
  updateMeeting,
  type Meeting,
} from "@/lib";
import {
  ArrowLeft,
  CalendarDays,
  Download,
  Loader2,
  PlusIcon,
  Sparkles,
  Trash2,
} from "lucide-react";
import moment from "moment";

const Meetings = () => {
  const { selectedAIProvider, allAiProviders, systemPrompt } = useApp();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);

  const [formTitle, setFormTitle] = useState("");
  const [formTranscript, setFormTranscript] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formSummary, setFormSummary] = useState("");

  const abortRef = useRef<AbortController | null>(null);

  const selected = meetings.find((m) => m.id === selectedId) || null;

  const loadMeetings = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const list = await listMeetings();
      setMeetings(list);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load meetings"
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

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
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps -- sync form when selection changes

  const openNewMeeting = () => {
    setSelectedId(null);
    setIsCreating(true);
    setFormTitle("");
    setFormTranscript("");
    setFormNotes("");
    setFormSummary("");
    setError(null);
  };

  const openMeeting = (id: string) => {
    setIsCreating(false);
    setSelectedId(id);
    setError(null);
  };

  const backToList = () => {
    abortRef.current?.abort();
    setIsSummarizing(false);
    setSelectedId(null);
    setIsCreating(false);
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
      ) : meetings.length === 0 ? (
        <Empty
          isLoading={isLoading}
          icon={CalendarDays}
          title="No meetings yet"
          description="Create a meeting and paste a Listen transcript to get started"
        />
      ) : (
        <div className="grid grid-cols-1 gap-3">
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
