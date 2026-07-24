import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Header,
} from "@/components";
import {
  listListenModes,
  removeListenMode,
  reorderListenMode,
  seedVeilDefaultPrompts,
} from "@/lib/database";
import type { ListenModeWithPrompt } from "@/types";
import { ArrowDown, ArrowUp, Headphones, Trash2 } from "lucide-react";

interface ListenModesProps {
  selectedPromptId: number | null;
  onSelectPrompt: (promptId: number) => void;
  onModesChanged?: () => void;
}

export const ListenModes = ({
  selectedPromptId,
  onSelectPrompt,
  onModesChanged,
}: ListenModesProps) => {
  const [modes, setModes] = useState<ListenModeWithPrompt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadModes = useCallback(async () => {
    try {
      setError(null);
      await seedVeilDefaultPrompts();
      const rows = await listListenModes();
      setModes(rows);
      onModesChanged?.();
    } catch (err) {
      console.error("Failed to load listen modes:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load listen modes"
      );
    } finally {
      setIsLoading(false);
    }
  }, [onModesChanged]);

  useEffect(() => {
    loadModes();
  }, [loadModes]);

  const handleReorder = async (id: string, direction: -1 | 1) => {
    try {
      await reorderListenMode(id, direction);
      const rows = await listListenModes();
      setModes(rows);
    } catch (err) {
      console.error("Failed to reorder listen mode:", err);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeListenMode(id);
      const rows = await listListenModes();
      setModes(rows);
    } catch (err) {
      console.error("Failed to remove listen mode:", err);
    }
  };

  const handleSelect = (mode: ListenModeWithPrompt) => {
    if (mode.prompt_id != null) {
      onSelectPrompt(mode.prompt_id);
    }
  };

  return (
    <div className="space-y-3">
      <Header
        title="Listen Modes"
        description="Quick profiles for live capture. Reorder, remove, or click a mode to select its prompt."
      />

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading listen modes…</p>
      ) : modes.length === 0 ? (
        <Card className="border border-dashed shadow-none !bg-black/5 dark:!bg-white/5 p-4">
          <CardHeader className="p-0">
            <CardTitle className="text-sm flex items-center gap-2">
              <Headphones className="size-4" />
              No listen modes yet
            </CardTitle>
            <CardDescription className="text-xs">
              Default modes seed automatically when the database is ready.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {modes.map((mode, index) => {
            const isSelected =
              mode.prompt_id != null && mode.prompt_id === selectedPromptId;
            return (
              <Card
                key={mode.id}
                className={`relative border lg:border-2 shadow-none p-3 gap-0 cursor-pointer transition-all hover:shadow-sm ${
                  isSelected
                    ? "!bg-primary/5 dark:!bg-primary/10 border-primary"
                    : "!bg-black/5 dark:!bg-white/5 border-transparent"
                }`}
                onClick={() => handleSelect(mode)}
              >
                <div className="flex items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={index === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReorder(mode.id, -1);
                      }}
                      aria-label={`Move ${mode.label} up`}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={index === modes.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReorder(mode.id, 1);
                      }}
                      aria-label={`Move ${mode.label} down`}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Headphones className="size-3.5 text-muted-foreground shrink-0" />
                      <CardTitle className="text-sm line-clamp-1">
                        {mode.label}
                      </CardTitle>
                      {mode.is_builtin ? (
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                          built-in
                        </span>
                      ) : null}
                    </div>
                    <CardDescription className="text-xs line-clamp-2">
                      {mode.blurb ||
                        mode.prompt_name ||
                        (mode.prompt_id
                          ? "Linked prompt"
                          : "No prompt linked")}
                    </CardDescription>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(mode.id);
                    }}
                    aria-label={`Remove ${mode.label}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
