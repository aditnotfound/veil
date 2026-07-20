import { AudioSelection } from "./components";
import { PageLayout } from "@/layouts";
import { getPlatform } from "@/lib";

const getOsInstructions = () => {
  const platform = getPlatform();

  switch (platform) {
    case "macos":
      return {
        mic: "System Preferences → Sound → Input",
        audio: "System Preferences → Sound → Output",
      };
    case "windows":
      return {
        mic: "Settings → System → Sound → Input",
        audio: "Settings → System → Sound → Output",
      };
    case "linux":
      return {
        mic: "Sound Settings → Input Devices",
        audio: "Sound Settings → Output Devices",
      };
    default:
      return {
        mic: "your system's sound settings",
        audio: "your system's sound settings",
      };
  }
};

const Audio = () => {
  const osInstructions = getOsInstructions();

  return (
    <PageLayout
      title="Audio Settings"
      description="Configure your audio input and output devices for voice interaction and system audio capture."
    >
      <AudioSelection />

      <div className="text-xs text-muted-foreground bg-muted/40 p-3 rounded-md mb-4 space-y-1">
        <p>
          <strong>Voice tip:</strong> Hold{" "}
          <span className="font-medium text-foreground">
            {getPlatform() === "macos" ? "⌘+Shift+A" : "Ctrl+Space"}
          </span>{" "}
          for push-to-talk voice input (default shortcut for Voice Input). You
          can change it under Cursor & Shortcuts. On macOS the default is{" "}
          <span className="font-medium text-foreground">⌘+Shift+A</span> because{" "}
          <span className="font-medium text-foreground">⌘+Space</span> is
          Spotlight.
        </p>
        <p>
          If you still have the previous default, use{" "}
          <span className="font-medium text-foreground">Ctrl+Shift+A</span>{" "}
          (Windows/Linux) until you reset shortcuts.
        </p>
      </div>

      <div className="text-xs text-amber-600 bg-amber-500/10 p-3 rounded-md mb-4 space-y-2">
        <p>
          <strong>⚠️ If selected devices don't work:</strong> Please verify your
          default system audio settings. Go to{" "}
          <strong>{osInstructions.mic}</strong> for microphone and{" "}
          <strong>{osInstructions.audio}</strong> for speakers/headphones.
          Ensure the correct devices are set as default in your operating
          system.
        </p>
        <p className="text-amber-600/80">
          <strong>Note:</strong> If the selected device fails or is unavailable,
          Veil will automatically fall back to your system's default audio
          devices.
        </p>
      </div>
    </PageLayout>
  );
};

export default Audio;
