import { ChatConversation } from "@/types";
import { Button, Markdown, Switch, CopyButton } from "@/components";
import { BotIcon, Loader2, SparklesIcon, TelescopeIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  lastTranscription: string;
  lastAnswerPrompt: string;
  partialSystemCaption: string;
  partialMicCaption: string;
  lastAIResponse: string;
  isAIProcessing: boolean;
  deepAIResponse: string;
  isDeepProcessing: boolean;
  deepAnswerStatus: "draft" | null;
  deepAnswerError: string;
  goDeeper: () => void;
  conversation: ChatConversation;
  conversationMode: boolean;
  setConversationMode: (mode: boolean) => void;
};

export const ResultsSection = ({
  lastTranscription,
  lastAnswerPrompt,
  partialSystemCaption,
  partialMicCaption,
  lastAIResponse,
  isAIProcessing,
  deepAIResponse,
  isDeepProcessing,
  deepAnswerStatus,
  deepAnswerError,
  goDeeper,
  conversation,
  conversationMode,
  setConversationMode,
}: Props) => {
  const hasResponse = lastAIResponse || isAIProcessing;
  const hasHistory = conversation.messages.length > 2;
  const latestText = lastTranscription.replace(/^(System|Mic):\s*/i, "");
  const showLatestTranscript = !!lastTranscription && (!hasResponse || latestText !== lastAnswerPrompt);

  if (!hasResponse && !lastTranscription && !partialSystemCaption && !partialMicCaption) {
    return null;
  }

  const isMac = navigator.platform.toLowerCase().includes("mac");
  const modKey = isMac ? "⌘" : "Ctrl";

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <SparklesIcon className="w-3.5 h-3.5 text-primary" />
          <h4 className="text-xs font-medium">
            {conversationMode ? "Conversation" : "AI Response"}
          </h4>
        </div>
        <div className="flex items-center gap-2 select-none">
          <span className="text-[9px] text-muted-foreground/50 bg-muted/50 px-1 rounded">
            {modKey}+K
          </span>
          <Switch
            checked={conversationMode}
            onCheckedChange={setConversationMode}
            className="scale-75"
          />
          {lastAIResponse && <CopyButton content={lastAIResponse} />}
        </div>
      </div>

      {(partialSystemCaption || partialMicCaption) && (
        <div className="space-y-1 text-[11px] text-muted-foreground" aria-live="polite">
          {partialSystemCaption && <p><span className="font-semibold">System · live:</span> {partialSystemCaption}</p>}
          {partialMicCaption && <p><span className="font-semibold">Mic · live:</span> {partialMicCaption}</p>}
        </div>
      )}

      {showLatestTranscript && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-semibold">Latest transcript · </span>{lastTranscription}
        </p>
      )}

      {/* Keep the answer tied to its original prompt as newer speech arrives. */}
      {!conversationMode && (
        <div className="space-y-2">
          {/* AI Response */}
          {hasResponse && (
            <div>
              {lastAnswerPrompt && (
                <p className="text-[11px] text-muted-foreground mb-2 line-clamp-2">
                  <span className="font-semibold">Answering · </span>{lastAnswerPrompt}
                </p>
              )}
              <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">
                Initial · unverified
              </p>
              {isAIProcessing && !lastAIResponse ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">
                    Generating response...
                  </span>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <Markdown>{lastAIResponse}</Markdown>
                  {isAIProcessing && (
                    <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* CONVERSATION MODE: AI on top, then System, then history */}
      {conversationMode && (
        <div className="space-y-2">
          {/* AI Response - First (on top) */}
          {hasResponse && (
            <div className="rounded-md bg-background/50 p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <BotIcon className="h-3 w-3 text-muted-foreground" />
                <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
                  AI
                </span>
              </div>
              {lastAnswerPrompt && (
                <p className="text-[10px] text-muted-foreground mb-2 line-clamp-2">
                  <span className="font-semibold">Answering · </span>{lastAnswerPrompt}
                </p>
              )}
              <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">
                Initial · unverified
              </p>
              {isAIProcessing && !lastAIResponse ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">
                    Generating...
                  </span>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none dark:prose-invert text-sm">
                  <Markdown>{lastAIResponse}</Markdown>
                  {isAIProcessing && (
                    <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Previous Messages */}
          {hasHistory && (
            <div className="space-y-2 pt-2 border-t border-border/50">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">
                Previous
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {conversation.messages
                  .slice(2)
                  .sort((a, b) => b.timestamp - a.timestamp)
                  .map((message, index) => (
                    <div
                      key={message.id || index}
                      className={cn(
                        "p-2 rounded-md text-[11px]",
                        message.role === "user"
                          ? "bg-primary/5 border-l-2 border-primary/30"
                          : "bg-background/50"
                      )}
                    >
                      <span className="text-[8px] font-medium text-muted-foreground uppercase">
                        {message.role === "user" ? "System" : "AI"}
                      </span>
                      <div className="text-muted-foreground leading-relaxed mt-0.5">
                        <Markdown>{message.content}</Markdown>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {lastAIResponse && !isAIProcessing && (
        <div className="pt-2 border-t border-border/50 space-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[10px] gap-1.5"
            onClick={goDeeper}
            disabled={isDeepProcessing}
          >
            {isDeepProcessing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <TelescopeIcon className="h-3 w-3" />
            )}
            {isDeepProcessing ? "Working deeper…" : "Go deeper"}
          </Button>

          {(deepAIResponse || isDeepProcessing || deepAnswerError) && (
            <div className="rounded-md bg-background/60 border border-border/50 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                  {deepAnswerStatus === "draft" ? "Deep draft · not independently checked" : "Deep draft in progress"}
                </span>
                {deepAIResponse && !isDeepProcessing && <CopyButton content={deepAIResponse} />}
              </div>
              {deepAnswerError && (
                <p className="text-[10px] text-destructive">{deepAnswerError}</p>
              )}
              {deepAIResponse && (
                <div className="prose prose-sm max-w-none dark:prose-invert text-sm">
                  <Markdown>{deepAIResponse}</Markdown>
                  {isDeepProcessing && (
                    <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />
                  )}
                </div>
              )}
              {isDeepProcessing && !deepAIResponse && (
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Building a careful draft…
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
