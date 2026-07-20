import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Input,
  Label,
  Textarea,
} from "@/components";
import { PageLayout } from "@/layouts";
import {
  createAppNote,
  deleteAppNote,
  listAppNotes,
  updateAppNote,
  type AppNote,
} from "@/lib";
import {
  ArrowLeft,
  Loader2,
  PlusIcon,
  StickyNote,
  Trash2,
} from "lucide-react";
import moment from "moment";

const Notes = () => {
  const [notes, setNotes] = useState<AppNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formBody, setFormBody] = useState("");

  const selected = notes.find((n) => n.id === selectedId) || null;
  const showEditor = isCreating || !!selected;

  const loadNotes = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setNotes(await listAppNotes());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notes");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    if (selected) {
      setFormTitle(selected.title);
      setFormBody(selected.body);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => {
    setSelectedId(null);
    setIsCreating(true);
    setFormTitle("");
    setFormBody("");
    setError(null);
  };

  const openNote = (id: string) => {
    setIsCreating(false);
    setSelectedId(id);
    setError(null);
  };

  const backToList = () => {
    setSelectedId(null);
    setIsCreating(false);
    setError(null);
  };

  const handleCreate = async () => {
    try {
      setIsSaving(true);
      setError(null);
      const created = await createAppNote({
        title: formTitle.trim() || "Untitled note",
        body: formBody,
      });
      setNotes((prev) => [created, ...prev]);
      setIsCreating(false);
      setSelectedId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create note");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!selectedId) return;
    try {
      setIsSaving(true);
      setError(null);
      const updated = await updateAppNote(selectedId, {
        title: formTitle,
        body: formBody,
      });
      setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setError(null);
      await deleteAppNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      if (selectedId === id) backToList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete note");
    }
  };

  return (
    <PageLayout
      title="Notes"
      description="Quick notes saved locally in Veil."
      rightSlot={
        !showEditor ? (
          <Button variant="default" size="default" onClick={openNew}>
            <PlusIcon className="size-4" />
            New note
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
            <div className="flex-1" />
            {isCreating ? (
              <Button onClick={handleCreate} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Create
              </Button>
            ) : (
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Save
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="note-title">Title</Label>
            <Input
              id="note-title"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="Note title"
              className="focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note-body">Body</Label>
            <Textarea
              id="note-body"
              value={formBody}
              onChange={(e) => setFormBody(e.target.value)}
              placeholder="Write your note…"
              className="min-h-48"
            />
          </div>
        </div>
      ) : notes.length === 0 ? (
        <Empty
          isLoading={isLoading}
          icon={StickyNote}
          title="No notes yet"
          description="Create a note to get started"
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {notes.map((note) => (
            <Card
              key={note.id}
              className="shadow-none select-none p-4 gap-2 relative transition-all !bg-black/5 dark:!bg-white/5 hover:!border-primary/50 cursor-pointer border-transparent"
              onClick={() => openNote(note.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium line-clamp-1 flex-1">
                  {note.title}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(note.id);
                  }}
                  title="Delete note"
                  aria-label={`Delete ${note.title}`}
                >
                  <Trash2 className="size-4 text-muted-foreground" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-3">
                {note.body || "Empty note"}
              </p>
              <p className="text-[10px] text-muted-foreground/80">
                {moment(note.updated_at).format("MMM D, h:mm A")}
              </p>
            </Card>
          ))}
        </div>
      )}
    </PageLayout>
  );
};

export default Notes;
