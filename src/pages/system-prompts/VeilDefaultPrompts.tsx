import { useMemo } from "react";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Header,
} from "@/components";
import { BotIcon, CheckCircle2, Sparkles } from "lucide-react";
import { useApp } from "@/contexts";
import { PROMPT_MODEL_RECOMMENDATIONS, STORAGE_KEYS, VEIL_DEFAULT_PROMPTS } from "@/config";
import { safeLocalStorage } from "@/lib";
import type { SystemPrompt } from "@/types";

interface VeilDefaultPromptsProps {
  prompts: SystemPrompt[];
  selectedPromptId: number | null;
  onSelectPrompt: (promptId: number) => void;
}

type DisplayPrompt = {
  name: string;
  blurb: string;
  prompt: string;
  recommended_model: string;
  recommended_provider: string;
  category: string;
  id?: number;
};

export const VeilDefaultPrompts = ({
  prompts,
  selectedPromptId,
  onSelectPrompt,
}: VeilDefaultPromptsProps) => {
  const { selectedAIProvider, onSetSelectedAIProvider, setSystemPrompt } =
    useApp();

  const displayPrompts = useMemo<DisplayPrompt[]>(() => {
    const defaults = prompts.filter((p) => p.is_default === 1);
    if (defaults.length > 0) {
      return defaults.map((p) => ({
        id: p.id,
        name: p.name,
        blurb: p.blurb || "",
        prompt: p.prompt,
        recommended_model: p.recommended_model || "gpt-4o-mini",
        recommended_provider: p.recommended_provider || "openai",
        category: p.category || "general",
      }));
    }

    return VEIL_DEFAULT_PROMPTS.map((pack) => ({
      name: pack.name,
      blurb: pack.blurb,
      prompt: pack.prompt,
      recommended_model: pack.recommended_model,
      recommended_provider: pack.recommended_provider,
      category: pack.category,
    }));
  }, [prompts]);

  const applyRecommendedModel = (item: DisplayPrompt) => {
    const provider =
      item.recommended_provider ||
      selectedAIProvider.provider ||
      "openai";
    const next = {
      provider,
      variables: {
        ...selectedAIProvider.variables,
        model: item.recommended_model,
      },
    };

    onSetSelectedAIProvider(next);
    safeLocalStorage.setItem(
      STORAGE_KEYS.SELECTED_AI_PROVIDER,
      JSON.stringify(next)
    );
  };

  const handleUse = (item: DisplayPrompt) => {
    if (item.id != null) {
      onSelectPrompt(item.id);
      return;
    }

    // Fallback when DB rows are not available yet
    setSystemPrompt(item.prompt);
    safeLocalStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPT, item.prompt);
    safeLocalStorage.removeItem(STORAGE_KEYS.SELECTED_SYSTEM_PROMPT_ID);
    safeLocalStorage.removeItem("selected_pluely_prompt");
  };

  const handleApply = (item: DisplayPrompt) => {
    applyRecommendedModel(item);
  };

  if (displayPrompts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 mt-6">
      <div className="flex items-start justify-between gap-3 border-t border-input/50 pt-6">
        <Header
          title="Veil Default Prompts"
          description="Curated listen-copilot profiles with recommended models. Use sets the prompt; Apply updates your selected model."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 pb-4">
        {displayPrompts.map((item) => {
          const isSelected =
            item.id != null && selectedPromptId === item.id;
          const why =
            PROMPT_MODEL_RECOMMENDATIONS[item.name]?.why ||
            "Recommended for this listen profile.";

          return (
            <Card
              key={`${item.name}-${item.id ?? "pack"}`}
              className={`relative border lg:border-2 shadow-none p-4 pb-12 gap-0 group transition-all hover:shadow-sm ${
                isSelected
                  ? "!bg-primary/5 dark:!bg-primary/10 border-primary"
                  : "!bg-black/5 dark:!bg-white/5 border-transparent"
              }`}
            >
              {isSelected && (
                <CheckCircle2 className="size-5 text-green-500 flex-shrink-0 absolute top-2 right-2" />
              )}
              <CardHeader className="p-0 pb-0 select-none">
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 pr-6">
                    <Sparkles className="size-3.5 text-muted-foreground shrink-0" />
                    <CardTitle className="text-base line-clamp-1">
                      {item.name}
                    </CardTitle>
                  </div>
                  <CardDescription className="h-12 line-clamp-3 text-xs leading-relaxed">
                    {item.blurb || item.prompt}
                  </CardDescription>
                  <div className="flex items-center gap-1.5 pt-1">
                    <Badge variant="secondary" className="text-[10px] font-normal gap-1">
                      <BotIcon className="size-3" />
                      {item.recommended_model}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground line-clamp-1" title={why}>
                      {item.recommended_provider}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <div className="absolute bottom-2 left-4 right-4 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => handleApply(item)}
                >
                  Apply
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => handleUse(item)}
                >
                  Use
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
