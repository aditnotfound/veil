import { useEffect, useState } from "react";
import {
  Card,
  Updater,
  DragButton,
  CustomCursor,
  Button,
  Markdown,
} from "@/components";
import {
  SystemAudio,
  Completion,
  AudioVisualizer,
  StatusIndicator,
} from "./components";
import { useApp } from "@/hooks";
import { useApp as useAppContext } from "@/contexts";
import { SparklesIcon, ImageIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorLayout } from "@/layouts";
import { getPlatform, safeLocalStorage } from "@/lib";
import { STORAGE_KEYS } from "@/config";
import { cn } from "@/lib/utils";

type OverlayMode = "ask" | "listen";

const App = () => {
  const { isHidden, systemAudio } = useApp();
  const { customizable } = useAppContext();
  const platform = getPlatform();

  const [overlayMode, setOverlayMode] = useState<OverlayMode>(() => {
    const stored = safeLocalStorage.getItem(STORAGE_KEYS.OVERLAY_MODE);
    return stored === "listen" ? "listen" : "ask";
  });
  const [useImageEveryMessage, setUseImageEveryMessage] = useState(() => {
    return (
      safeLocalStorage.getItem(STORAGE_KEYS.USE_IMAGE_EVERY_MESSAGE) === "true"
    );
  });

  useEffect(() => {
    safeLocalStorage.setItem(STORAGE_KEYS.OVERLAY_MODE, overlayMode);
  }, [overlayMode]);

  useEffect(() => {
    safeLocalStorage.setItem(
      STORAGE_KEYS.USE_IMAGE_EVERY_MESSAGE,
      String(useImageEveryMessage)
    );
  }, [useImageEveryMessage]);

  const openDashboard = async () => {
    try {
      await invoke("open_dashboard");
    } catch (error) {
      console.error("Failed to open dashboard:", error);
    }
  };

  const isListen = overlayMode === "listen";
  const showAskInput = !isListen && !systemAudio?.capturing;
  const showListenPanel = isListen;

  return (
    <ErrorBoundary
      fallbackRender={() => {
        return <ErrorLayout isCompact />;
      }}
      resetKeys={["app-error"]}
      onReset={() => {
        console.log("Reset");
      }}
    >
      <div
        className={`w-screen h-screen flex overflow-hidden justify-center items-start ${
          isHidden ? "hidden pointer-events-none" : ""
        }`}
      >
        <Card className="w-full flex flex-row items-center gap-2 p-2">
          {/* Ask | Listen mode toggle */}
          <div className="flex items-center bg-muted rounded-md p-0.5 flex-shrink-0">
            <button
              type="button"
              onClick={() => setOverlayMode("ask")}
              className={cn(
                "px-2 py-1 text-[10px] font-medium rounded transition-colors",
                !isListen
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Ask
            </button>
            <button
              type="button"
              onClick={() => setOverlayMode("listen")}
              className={cn(
                "px-2 py-1 text-[10px] font-medium rounded transition-colors",
                isListen
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Listen
            </button>
          </div>

          {/* Use image every message */}
          <Button
            size="icon"
            variant={useImageEveryMessage ? "default" : "ghost"}
            title={
              useImageEveryMessage
                ? "Use image: on (screenshot with each message)"
                : "Use image: off"
            }
            onClick={() => setUseImageEveryMessage((prev) => !prev)}
            className={cn(
              "h-8 w-8 flex-shrink-0",
              useImageEveryMessage && "bg-primary text-primary-foreground"
            )}
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </Button>

          <SystemAudio {...systemAudio} />

          {isListen && (
            <Button
              type="button"
              size="sm"
              className="h-8 flex-shrink-0 text-[11px]"
              title={systemAudio.latestSystemTurn
                ? "Answer the latest completed call-audio turn"
                : "Waiting for a completed call-audio transcript"}
              disabled={!systemAudio.capturing || !systemAudio.latestSystemTurn || systemAudio.isAIProcessing}
              onClick={() => void systemAudio.answerLatestSystemTurn()}
            >
              {systemAudio.isAIProcessing ? "Answering…" : "Answer now"}
            </Button>
          )}

          {(systemAudio?.capturing || isListen) && (
            <div className="flex flex-row items-center gap-2 justify-between w-full min-w-0">
              <div className="flex flex-1 items-center gap-2 min-w-0">
                {systemAudio?.capturing ? (
                  <AudioVisualizer isRecording={systemAudio?.capturing} />
                ) : (
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    Listen mode — start capture
                  </span>
                )}
              </div>
              <div className="flex !w-fit items-center gap-2 flex-shrink-0">
                <StatusIndicator
                  setupRequired={systemAudio.setupRequired}
                  error={systemAudio.error}
                  isProcessing={systemAudio.isProcessing}
                  isAIProcessing={systemAudio.isAIProcessing}
                  capturing={systemAudio.capturing}
                />
              </div>
            </div>
          )}

          {/* Compact preview; the full answer is in the expanded Listen panel. */}
          {showListenPanel &&
            (systemAudio.lastTranscription ||
              systemAudio.lastAIResponse ||
              systemAudio.isAIProcessing) && (
              <div className="flex flex-col gap-0.5 min-w-0 max-w-[30%] flex-shrink">
                {systemAudio.lastTranscription && (
                  <p className="text-[10px] text-muted-foreground truncate">
                    {systemAudio.lastTranscription}
                  </p>
                )}
                {(systemAudio.lastAIResponse || systemAudio.isAIProcessing) && (
                  <div className="text-[10px] truncate max-h-8 overflow-hidden prose prose-sm dark:prose-invert" title="Full answer appears in the expanded Listen panel">
                    {systemAudio.isAIProcessing &&
                    !systemAudio.lastAIResponse ? (
                      <span className="text-muted-foreground animate-pulse">
                        Thinking…
                      </span>
                    ) : (
                      <Markdown>{systemAudio.lastAIResponse}</Markdown>
                    )}
                  </div>
                )}
              </div>
            )}

          <div
            className={`${
              showAskInput
                ? "w-full flex flex-row gap-2 items-center"
                : "hidden w-full fade-out transition-all duration-300"
            }`}
          >
            <Completion isHidden={isHidden} showAudio={showAskInput} />
            <Button
              size={"icon"}
              className="cursor-pointer"
              title="Open Dev Space"
              onClick={openDashboard}
            >
              <SparklesIcon className="h-4 w-4" />
            </Button>
          </div>

          {/* Dashboard shortcut still available in Listen mode */}
          {!showAskInput && (
            <Button
              size={"icon"}
              className="cursor-pointer flex-shrink-0"
              title="Open Dev Space"
              onClick={openDashboard}
            >
              <SparklesIcon className="h-4 w-4" />
            </Button>
          )}

          <Updater />
          <DragButton />
        </Card>
        {customizable.cursor.type === "invisible" && platform !== "linux" ? (
          <CustomCursor />
        ) : null}
      </div>
    </ErrorBoundary>
  );
};

export default App;
