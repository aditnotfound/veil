import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "./helper";

export type IntervalMonitorConfig = {
  enabled: boolean;
  intervalMs: number;
  prompt: string;
};

export const INTERVAL_MONITOR_OPTIONS = [
  { label: "15 seconds", value: 15_000 },
  { label: "30 seconds", value: 30_000 },
  { label: "60 seconds", value: 60_000 },
  { label: "5 minutes", value: 300_000 },
] as const;

export const DEFAULT_INTERVAL_MONITOR: IntervalMonitorConfig = {
  enabled: false,
  intervalMs: 30_000,
  prompt:
    "Describe what you see on screen. Note any important text, UI changes, or action items.",
};

export function getIntervalMonitorConfig(): IntervalMonitorConfig {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEYS.INTERVAL_MONITOR);
    if (!raw) return { ...DEFAULT_INTERVAL_MONITOR };
    const parsed = JSON.parse(raw) as Partial<IntervalMonitorConfig>;
    const intervalMs = INTERVAL_MONITOR_OPTIONS.some(
      (o) => o.value === parsed.intervalMs
    )
      ? (parsed.intervalMs as number)
      : DEFAULT_INTERVAL_MONITOR.intervalMs;
    return {
      enabled: Boolean(parsed.enabled),
      intervalMs,
      prompt:
        typeof parsed.prompt === "string" && parsed.prompt.trim()
          ? parsed.prompt
          : DEFAULT_INTERVAL_MONITOR.prompt,
    };
  } catch {
    return { ...DEFAULT_INTERVAL_MONITOR };
  }
}

export const INTERVAL_MONITOR_CHANGED_EVENT = "interval-monitor-changed";

export function setIntervalMonitorConfig(
  config: IntervalMonitorConfig
): void {
  safeLocalStorage.setItem(
    STORAGE_KEYS.INTERVAL_MONITOR,
    JSON.stringify(config)
  );
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(INTERVAL_MONITOR_CHANGED_EVENT));
  }
}
