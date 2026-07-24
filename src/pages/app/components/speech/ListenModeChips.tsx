import type { ListenModeWithPrompt } from "@/types";
import { cn } from "@/lib/utils";
import { Headphones } from "lucide-react";

interface ListenModeChipsProps {
  modes: ListenModeWithPrompt[];
  selectedModeId: string | null;
  onSelectMode: (mode: ListenModeWithPrompt) => void;
}

export const ListenModeChips = ({
  modes,
  selectedModeId,
  onSelectMode,
}: ListenModeChipsProps) => {
  if (modes.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-0.5">
        <Headphones className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Listen Modes
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {modes.map((mode) => {
          const isSelected = mode.id === selectedModeId;
          const disabled = !mode.prompt_text?.trim();
          return (
            <button
              key={mode.id}
              type="button"
              disabled={disabled}
              title={mode.blurb || mode.prompt_name || mode.label}
              onClick={() => onSelectMode(mode)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all border",
                isSelected
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-accent",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              {mode.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
