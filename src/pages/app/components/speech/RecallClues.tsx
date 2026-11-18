import { LightbulbIcon } from "lucide-react";
import type { RecallHit } from "@/lib/memory";

/** Glanceable hints from memory while the other side is talking. */
export function RecallClues({ clues, compact }: { clues: RecallHit[]; compact?: boolean }) {
  if (!clues.length) return null;
  return (
    <div className="rounded-lg border border-dashed border-primary/30 px-2 py-1.5 space-y-1" aria-live="polite"
      title="Matches from your memory and library for what is being said. Hints only; answers use the finished question.">
      <p className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-muted-foreground">
        <LightbulbIcon className="h-3 w-3" />Clues from your memory
      </p>
      {clues.slice(0, compact ? 1 : 3).map((clue) => (
        <p key={clue.id} className="text-[10px] leading-snug line-clamp-2 break-words">
          <span className="text-muted-foreground">{clue.kind === "memory" ? "Memory" : clue.title}: </span>
          {clue.text.replace(/^\[[^\]]*\]\n/, "").replace(/\s+/g, " ")}
        </p>
      ))}
    </div>
  );
}
