import { useState } from "react";
import { Loader2, XIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  ScrollArea,
  Input as InputComponent,
  Markdown,
  Switch,
  CopyButton,
} from "@/components";
import { UseCompletionReturn } from "@/types";
import { MessageHistory } from "./MessageHistory";
import { cn } from "@/lib/utils";

const FOLLOW_UP_CHIPS = [
  "Make concise",
  "Go deeper",
  "What should I say next?",
] as const;

const ANSWER_TRANSFORMS = [
  {
    label: "Concise",
    buildPrompt: (last: string) =>
      `Rewrite the following response to be more concise while keeping the key meaning:\n\n---\n${last}`,
  },
  {
    label: "Key points",
    buildPrompt: (last: string) =>
      `Extract the key points from the following response as a short bullet list:\n\n---\n${last}`,
  },
  {
    label: "Translate",
    buildPrompt: (last: string) =>
      `Translate the following response into the user's preferred language (or English if unclear). Keep meaning intact:\n\n---\n${last}`,
  },
] as const;

export const Input = ({
  isPopoverOpen,
  isLoading,
  reset,
  input,
  setInput,
  handleKeyPress,
  handlePaste,
  currentConversationId,
  conversationHistory,
  startNewConversation,
  messageHistoryOpen,
  setMessageHistoryOpen,
  error,
  response,
  cancel,
  scrollAreaRef,
  inputRef,
  isHidden,
  keepEngaged,
  setKeepEngaged,
  submit,
}: UseCompletionReturn & { isHidden: boolean }) => {
  const [historyView, setHistoryView] = useState<"latest" | "all">("latest");

  const lastUserMessage = [...conversationHistory]
    .reverse()
    .find((m) => m.role === "user");
  const lastAssistantMessage = [...conversationHistory]
    .reverse()
    .find((m) => m.role === "assistant");

  // Prefer live input while generating so Latest doesn't show the prior turn
  const latestUserContent =
    isLoading && input.trim()
      ? input
      : lastUserMessage?.content || input;
  const latestAssistantContent = response || lastAssistantMessage?.content || "";

  const handleFollowUp = (chip: string) => {
    setInput(chip);
    void submit(chip);
  };

  const handleTransform = (buildPrompt: (last: string) => string) => {
    const last = (response || latestAssistantContent || "").trim();
    if (!last) return;
    const prompt = buildPrompt(last);
    setInput(prompt);
    void submit(prompt);
  };

  return (
    <div className="relative flex-1">
      <Popover
        open={isPopoverOpen}
        onOpenChange={(open) => {
          if (!open && !isLoading && !keepEngaged) {
            reset();
          }
        }}
      >
        <PopoverTrigger asChild className="!border-none !bg-transparent">
          <div className="relative select-none">
            <InputComponent
              ref={inputRef}
              placeholder="Ask me anything..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              onPaste={handlePaste}
              disabled={isLoading || isHidden}
              className={`${
                currentConversationId && conversationHistory.length > 0
                  ? "pr-14"
                  : "pr-2"
              }`}
            />

            {/* Conversation thread indicator */}
            {currentConversationId &&
              conversationHistory.length > 0 &&
              !isLoading && (
                <div className="absolute select-none right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <MessageHistory
                    conversationHistory={conversationHistory}
                    currentConversationId={currentConversationId}
                    onStartNewConversation={startNewConversation}
                    messageHistoryOpen={messageHistoryOpen}
                    setMessageHistoryOpen={setMessageHistoryOpen}
                  />
                </div>
              )}

            {/* Loading indicator */}
            {isLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 animate-pulse">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </PopoverTrigger>

        {/* Response Panel */}
        <PopoverContent
          align="end"
          side="bottom"
          className="w-screen p-0 border shadow-lg overflow-hidden"
          sideOffset={8}
        >
          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
            <div className="flex flex-row gap-1 items-center">
              <h3 className="font-semibold text-xs select-none">
                {keepEngaged ? "Conversation Mode" : "AI Response"}
              </h3>
              <div className="text-[10px] text-muted-foreground/70">
                (Use arrow keys to scroll)
              </div>
            </div>
            <div className="flex items-center gap-2 select-none">
              <div className="flex flex-row items-center gap-2 mr-2">
                <p className="text-[10px]">{`Toggle ${
                  keepEngaged ? "AI response" : "conversation mode"
                }`}</p>
                <span className="text-[10px] text-muted-foreground/60 bg-muted/30 px-1 py-0 rounded border border-input/50">
                  {navigator.platform.toLowerCase().includes("mac")
                    ? "⌘"
                    : "Ctrl"}{" "}
                  + K
                </span>
                <Switch
                  checked={keepEngaged}
                  onCheckedChange={(checked) => {
                    setKeepEngaged(checked);
                    // Focus input after toggle
                    setTimeout(() => {
                      inputRef?.current?.focus();
                    }, 100);
                  }}
                />
              </div>
              <CopyButton content={response} />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  if (isLoading) {
                    cancel();
                  } else if (keepEngaged) {
                    // When keepEngaged is on, close everything and start new conversation
                    setKeepEngaged(false);
                    startNewConversation();
                  } else {
                    reset();
                  }
                }}
                className="cursor-pointer"
                title={
                  isLoading
                    ? "Cancel loading"
                    : keepEngaged
                      ? "Close and start new conversation"
                      : "Clear conversation"
                }
              >
                <XIcon />
              </Button>
            </div>
          </div>

          {/* Latest / All tabs */}
          <div className="flex items-center gap-1 px-4 py-1.5 border-b bg-muted/10">
            <button
              type="button"
              onClick={() => setHistoryView("latest")}
              className={cn(
                "px-2.5 py-1 text-[10px] font-medium rounded transition-colors",
                historyView === "latest"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Latest
            </button>
            <button
              type="button"
              onClick={() => setHistoryView("all")}
              className={cn(
                "px-2.5 py-1 text-[10px] font-medium rounded transition-colors",
                historyView === "all"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              All
            </button>
          </div>

          <ScrollArea ref={scrollAreaRef} className="h-[calc(100vh-9rem)]">
            <div className="p-4">
              {error && (
                <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
                  <strong>Error:</strong> {error}
                </div>
              )}
              {isLoading && (
                <div className="flex items-center gap-2 my-4 text-muted-foreground animate-pulse select-none">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Generating response...</span>
                </div>
              )}

              {historyView === "latest" ? (
                <div className="space-y-3">
                  {latestUserContent && (
                    <div className="p-3 rounded-lg text-sm bg-primary/10 border-l-4 border-primary">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-medium text-muted-foreground uppercase">
                          You
                        </span>
                      </div>
                      <Markdown>{latestUserContent}</Markdown>
                    </div>
                  )}
                  {latestAssistantContent && (
                    <div className="space-y-2">
                      <Markdown>{latestAssistantContent}</Markdown>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {conversationHistory.length === 0 && response && (
                    <Markdown>{response}</Markdown>
                  )}
                  {conversationHistory
                    .slice()
                    .sort((a, b) => a?.timestamp - b?.timestamp)
                    .map((message) => (
                      <div
                        key={message.id}
                        className={`p-3 rounded-lg text-sm ${
                          message.role === "user"
                            ? "bg-primary/10 border-l-4 border-primary"
                            : "bg-muted/50"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-medium text-muted-foreground uppercase">
                            {message.role === "user" ? "You" : "AI"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(message.timestamp).toLocaleTimeString(
                              [],
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )}
                          </span>
                        </div>
                        <Markdown>{message.content}</Markdown>
                      </div>
                    ))}
                  {/* Streaming response not yet saved */}
                  {isLoading && response && (
                    <div className="p-3 rounded-lg text-sm bg-muted/50">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-medium text-muted-foreground uppercase">
                          AI
                        </span>
                      </div>
                      <Markdown>{response}</Markdown>
                    </div>
                  )}
                </div>
              )}

              {/* Follow-up chips + answer transforms after assistant response */}
              {response && !isLoading && (
                <div className="mt-4 pt-3 border-t border-border/50 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {FOLLOW_UP_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => handleFollowUp(chip)}
                        className="px-2.5 py-1 text-[10px] font-medium rounded-full border border-border bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground mr-0.5">
                      Transform:
                    </span>
                    {ANSWER_TRANSFORMS.map((transform) => (
                      <button
                        key={transform.label}
                        type="button"
                        onClick={() => handleTransform(transform.buildPrompt)}
                        className="px-2.5 py-1 text-[10px] font-medium rounded-full border border-primary/30 bg-primary/5 hover:bg-primary/10 text-foreground transition-colors"
                      >
                        {transform.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Conversation History when keep engaged (legacy companion view) */}
              {keepEngaged &&
                historyView === "latest" &&
                conversationHistory.length > 2 && (
                  <div className="space-y-3 pt-3 mt-3 border-t border-border/40">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      Earlier
                    </p>
                    {conversationHistory
                      .slice()
                      .sort((a, b) => b?.timestamp - a?.timestamp)
                      .slice(2)
                      .map((message) => (
                        <div
                          key={message.id}
                          className={`p-3 rounded-lg text-sm ${
                            message.role === "user"
                              ? "bg-primary/10 border-l-4 border-primary"
                              : "bg-muted/50"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-medium text-muted-foreground uppercase">
                              {message.role === "user" ? "You" : "AI"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(message.timestamp).toLocaleTimeString(
                                [],
                                {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }
                              )}
                            </span>
                          </div>
                          <Markdown>{message.content}</Markdown>
                        </div>
                      ))}
                  </div>
                )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
};
