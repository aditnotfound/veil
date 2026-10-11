import { Button } from "@/components";
import type { FinalUtterance } from "@/lib/call/session-core";
import type { CaptionStatus } from "@/lib/call/deepgram-live-captions";
import { ChevronDownIcon, ListIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  utterances: FinalUtterance[];
  partialSystem: string;
  partialMic: string;
  liveAvailable: boolean;
  liveEnabled: boolean;
  systemStatus: CaptionStatus | "off";
  expanded: boolean;
  showAll: boolean;
  compact: boolean;
  onToggle: () => void;
  onShowAll: () => void;
};

export const TranscriptPanel = ({ utterances, partialSystem, partialMic,
  liveAvailable, liveEnabled, systemStatus, expanded, showAll, compact,
  onToggle, onShowAll }: Props) => {
  const latest = utterances[utterances.length - 1];
  const preview = partialSystem || partialMic || latest?.text || "Waiting for speech…";
  const status = !liveAvailable ? "Batch only · Deepgram needed for live text"
    : !liveEnabled ? "Live text off" : systemStatus === "live" ? "Live"
      : systemStatus === "fallback" ? "Live unavailable · batch active" : "Connecting";
  const visible = showAll ? utterances : utterances.slice(-5);

  return (
    <section className="rounded-lg border border-border/50 bg-muted/20 p-2 space-y-1.5" aria-label="Call transcript">
      <div className="flex items-center gap-1 min-w-0">
        <button type="button" onClick={onToggle} aria-expanded={expanded}
          className="flex-1 min-w-0 flex items-center gap-1 text-left text-[11px] hover:text-primary"
          title={expanded ? "Collapse transcript" : "Expand live transcript"}>
          <ChevronDownIcon className={cn("w-3.5 h-3.5 shrink-0 transition-transform", expanded && "rotate-180")} />
          <span className="font-medium shrink-0">Transcript</span>
          <span className="truncate text-muted-foreground" aria-live="polite">{preview}</span>
        </button>
        <span className="text-[9px] text-muted-foreground shrink-0">{status}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onShowAll}
          className="h-6 px-1.5 text-[10px] gap-1 shrink-0" title="Show every finalized transcript in this call">
          <ListIcon className="w-3 h-3" /> All ({utterances.length})
        </Button>
      </div>
      {expanded && !compact && (
        <div className="space-y-2 text-[11px]">
          {(partialSystem || partialMic) && (
            <div className="space-y-1 border-l-2 border-primary/40 pl-2" aria-live="polite">
              {partialSystem && <p><span className="font-medium">System · live: </span>{partialSystem}</p>}
              {partialMic && <p><span className="font-medium">Mic · live: </span>{partialMic}</p>}
            </div>
          )}
          {visible.length > 0 ? (
            <div className="max-h-52 overflow-y-auto space-y-1.5" role="log" aria-label="Finalized call transcripts">
              {visible.map((turn) => (
                <p key={turn.id} className="rounded bg-background/60 px-2 py-1 whitespace-pre-wrap break-words">
                  <span className="font-medium text-muted-foreground">
                    {turn.source === "mic" ? "Mic" : "System"} · {new Date(turn.startedAt).toLocaleTimeString()}:
                  </span>{" "}{turn.text}
                </p>
              ))}
            </div>
          ) : !partialSystem && !partialMic && (
            <p className="text-muted-foreground">Finalized transcripts will appear here.</p>
          )}
          {!showAll && utterances.length > 5 && (
            <button type="button" onClick={onShowAll} className="text-primary hover:underline">
              Show all {utterances.length} turns
            </button>
          )}
        </div>
      )}
    </section>
  );
};
