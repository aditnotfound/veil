import { useLayoutEffect, useRef } from "react";
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
  liveProvider: "openai" | "deepgram" | null;
  liveEnabled: boolean;
  systemStatus: CaptionStatus | "off";
  expanded: boolean;
  compact: boolean;
  onToggle: () => void;
  onShowAll: () => void;
};

export const TranscriptPanel = ({ utterances, partialSystem, partialMic,
  liveAvailable, liveProvider, liveEnabled, systemStatus, expanded, compact,
  onToggle, onShowAll }: Props) => {
  const previewRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const followHistoryRef = useRef(true);
  const wasExpandedRef = useRef(false);
  const status = !liveAvailable ? "Live needs OpenAI key"
    : !liveEnabled ? "Live text off" : systemStatus === "live" ? `Live · ${liveProvider === "openai" ? "OpenAI" : "Deepgram"}`
      : systemStatus === "fallback" ? "Live unavailable · batch active" : "Connecting";

  // The small view always follows the latest words. The full view follows until
  // someone scrolls up to read an earlier turn.
  useLayoutEffect(() => {
    if (previewRef.current) previewRef.current.scrollTop = previewRef.current.scrollHeight;
    if (expanded && !compact && historyRef.current) {
      if (!wasExpandedRef.current || followHistoryRef.current) {
        historyRef.current.scrollTop = historyRef.current.scrollHeight;
      }
    }
    wasExpandedRef.current = expanded && !compact;
  }, [utterances, partialSystem, partialMic, expanded, compact]);

  const liveText = partialSystem || partialMic;
  const recentTurns = utterances.slice(-3);

  return (
    <section className="rounded-lg border border-border/50 bg-muted/20 p-2 space-y-1.5" aria-label="Call transcript">
      <div className="flex items-center gap-1 min-w-0">
        <button type="button" onClick={onToggle} aria-expanded={expanded}
          className="flex-1 min-w-0 flex items-center gap-1 text-left text-[11px] hover:text-primary"
          title={expanded ? "Collapse transcript" : "Expand full transcript"}>
          <ChevronDownIcon className={cn("w-3.5 h-3.5 shrink-0 transition-transform", expanded && "rotate-180")} />
          <span className="font-medium shrink-0">Transcript</span>
        </button>
        <span className="text-[9px] text-muted-foreground shrink-0">{status}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onShowAll}
          className="h-6 px-1.5 text-[10px] gap-1 shrink-0" title="Open the full transcript for this call">
          <ListIcon className="w-3 h-3" /> All ({utterances.length})
        </Button>
      </div>
      {(!expanded || compact) ? (
        <button type="button" onClick={onShowAll} className="block w-full text-left"
          title="Open full transcript" aria-label="Open full transcript">
          <div ref={previewRef} className="h-9 overflow-y-hidden text-[11px] leading-[18px] whitespace-pre-wrap break-words text-muted-foreground">
            {recentTurns.map((turn) => (
              <div key={turn.id}><span className="font-medium">{turn.source === "mic" ? "Mic" : "System"}: </span>{turn.text}</div>
            ))}
            {partialMic && <div className="text-foreground"><span className="font-medium">Mic · live: </span>{partialMic}</div>}
            {partialSystem && <div className="text-foreground"><span className="font-medium">System · live: </span>{partialSystem}</div>}
            {!recentTurns.length && !liveText && <div>Waiting for speech…</div>}
          </div>
        </button>
      ) : (
        <div ref={historyRef} className="max-h-64 overflow-y-auto space-y-1.5 text-[11px]"
          role="log" aria-label="Call transcript history"
          onScroll={(event) => {
            const node = event.currentTarget;
            followHistoryRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
          }}>
          {utterances.map((turn) => (
            <p key={turn.id} className="rounded bg-background/60 px-2 py-1 whitespace-pre-wrap break-words">
              <span className="font-medium text-muted-foreground">
                {turn.source === "mic" ? "Mic" : "System"} · {new Date(turn.startedAt).toLocaleTimeString()}:
              </span>{" "}{turn.text}
            </p>
          ))}
          {partialMic && <p className="border-l-2 border-primary/40 pl-2 whitespace-pre-wrap break-words"><span className="font-medium">Mic · live: </span>{partialMic}</p>}
          {partialSystem && <p className="border-l-2 border-primary/40 pl-2 whitespace-pre-wrap break-words"><span className="font-medium">System · live: </span>{partialSystem}</p>}
          {!utterances.length && !liveText && <p className="text-muted-foreground">Waiting for speech…</p>}
        </div>
      )}
    </section>
  );
};
