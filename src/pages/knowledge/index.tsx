import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  Input,
  Label,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@/components";
import { PageLayout } from "@/layouts";
import { useApp } from "@/contexts";
import {
  deleteKnowledgeSource,
  extractTextFromFile,
  getKnowledgeSettings,
  ingestKnowledgeSource,
  listKnowledgeSources,
  setKnowledgeEnabled,
  setKnowledgeFocusTags,
  type KnowledgeSource,
} from "@/lib/knowledge";
import { Brain, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { Interview } from "./Interview";

function parseCommaTags(value: string): string[] {
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

const Knowledge = () => {
  const { selectedAIProvider } = useApp();
  const apiKey = selectedAIProvider?.variables?.api_key?.trim() || "";

  const [enabled, setEnabled] = useState(true);
  const [focusTagsInput, setFocusTagsInput] = useState("");
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [noteTitle, setNoteTitle] = useState("");
  const [noteTags, setNoteTags] = useState("");
  const [noteBody, setNoteBody] = useState("");

  const loadSources = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const list = await listKnowledgeSources();
      setSources(list);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load knowledge sources"
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const settings = getKnowledgeSettings();
    setEnabled(settings.enabled);
    setFocusTagsInput(settings.focusTags.join(", "));
    loadSources();
  }, [loadSources]);

  const handleEnabledChange = (checked: boolean) => {
    setEnabled(checked);
    setKnowledgeEnabled(checked);
  };

  const handleFocusTagsBlur = () => {
    const tags = parseCommaTags(focusTagsInput);
    setKnowledgeFocusTags(tags);
    setFocusTagsInput(tags.join(", "));
  };

  const handleDelete = async (id: string) => {
    try {
      setError(null);
      await deleteKnowledgeSource(id);
      setSources((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete knowledge source"
      );
    }
  };

  const requireApiKey = () => {
    if (!apiKey) {
      throw new Error(
        "Select an AI provider with an API key before ingesting knowledge."
      );
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      setError(null);
      requireApiKey();
      await ingestKnowledgeSource({
        title: noteTitle.trim() || "Untitled note",
        kind: "note",
        text: noteBody,
        tags: parseCommaTags(noteTags),
        apiKey,
      });
      setNoteTitle("");
      setNoteTags("");
      setNoteBody("");
      await loadSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add note");
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      setIsSaving(true);
      setError(null);
      requireApiKey();
      const text = await extractTextFromFile(file);
      await ingestKnowledgeSource({
        title: file.name,
        kind: "file",
        text,
        tags: [],
        apiKey,
      });
      await loadSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload file");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PageLayout
      title="Knowledge"
      description="Manage personal notes and interview your profile into the library."
    >
      <Tabs defaultValue="library" className="gap-4">
        <TabsList>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="interview">Interview</TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="space-y-6">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {!apiKey && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
              <p className="text-sm text-amber-700 dark:text-amber-400">
                An AI provider API key is required to ingest notes and files
                (embeddings). Configure one in Dev space.
              </p>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-xl">
              <div>
                <Label className="text-sm font-medium">
                  Use personal knowledge
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  When enabled, relevant notes and files are injected into AI
                  responses
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={handleEnabledChange}
                title="Toggle personal knowledge"
                aria-label="Toggle personal knowledge"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="focus-tags" className="text-sm font-medium">
                Focus tags
              </Label>
              <Input
                id="focus-tags"
                type="text"
                placeholder="work, personal, project-x"
                value={focusTagsInput}
                onChange={(e) => setFocusTagsInput(e.target.value)}
                onBlur={handleFocusTagsBlur}
                className="focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated. Retrieval prefers sources matching these tags.
              </p>
            </div>
          </div>

          <form
            onSubmit={handleAddNote}
            className="space-y-3 p-4 border rounded-xl"
          >
            <div>
              <Label className="text-sm font-medium">Add note</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Save a text note into your personal knowledge library
              </p>
            </div>
            <Input
              type="text"
              placeholder="Title"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              className="focus-visible:ring-0 focus-visible:ring-offset-0"
              disabled={isSaving}
            />
            <Input
              type="text"
              placeholder="Tags (comma-separated)"
              value={noteTags}
              onChange={(e) => setNoteTags(e.target.value)}
              className="focus-visible:ring-0 focus-visible:ring-offset-0"
              disabled={isSaving}
            />
            <Textarea
              placeholder="Note body…"
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              className="min-h-28"
              disabled={isSaving}
              required
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={isSaving || !noteBody.trim()}>
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileText className="size-4" />
                )}
                Add note
              </Button>
              <Label
                htmlFor="knowledge-file-upload"
                className={`inline-flex items-center gap-2 h-9 px-4 rounded-xl border cursor-pointer text-sm font-medium transition-colors hover:bg-accent ${
                  isSaving ? "pointer-events-none opacity-50" : ""
                }`}
              >
                <Upload className="size-4" />
                Upload file
              </Label>
              <input
                id="knowledge-file-upload"
                type="file"
                accept=".txt,.md,.csv,text/plain,text/markdown,text/csv"
                className="hidden"
                onChange={handleFileUpload}
                disabled={isSaving}
              />
              <span className="text-xs text-muted-foreground">
                .txt, .md, .csv
              </span>
            </div>
          </form>

          <div className="space-y-3">
            <div>
              <Label className="text-sm font-medium">Sources</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Notes and files currently in your knowledge library
              </p>
            </div>

            {sources.length === 0 ? (
              <Empty
                isLoading={isLoading}
                icon={Brain}
                title="No sources yet"
                description="Add a note or upload a file to get started"
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {sources.map((source) => (
                  <Card
                    key={source.id}
                    className="relative border lg:border-2 shadow-none p-4 gap-2 !bg-black/5 dark:!bg-white/5 border-transparent"
                  >
                    <CardHeader className="p-0 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-sm line-clamp-1 flex-1 pr-2">
                          {source.title}
                        </CardTitle>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0"
                          onClick={() => handleDelete(source.id)}
                          title="Delete source"
                          aria-label={`Delete ${source.title}`}
                        >
                          <Trash2 className="size-4 text-muted-foreground" />
                        </Button>
                      </div>
                      <CardDescription className="text-xs">
                        {source.kind}
                        {source.tags.length > 0
                          ? ` · ${source.tags.join(", ")}`
                          : ""}
                      </CardDescription>
                      <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                        {source.raw_text}
                      </p>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="interview">
          <Interview />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
};

export default Knowledge;
