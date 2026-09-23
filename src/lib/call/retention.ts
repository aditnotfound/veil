export const CALL_RETENTION_STORAGE_KEY = "call_retention_days";

export const CALL_RETENTION_OPTIONS = [0, 7, 30, 90] as const;

export type CallRetentionDays = (typeof CALL_RETENTION_OPTIONS)[number];

export function parseCallRetentionDays(value: string | null): CallRetentionDays {
  const parsed = Number(value);
  return CALL_RETENTION_OPTIONS.includes(parsed as CallRetentionDays)
    ? parsed as CallRetentionDays
    : 0;
}

export function callRetentionCutoff(
  days: CallRetentionDays,
  now = Date.now()
): number | null {
  if (days === 0) return null;
  return now - days * 24 * 60 * 60 * 1_000;
}

export function callRetentionLabel(days: CallRetentionDays): string {
  return days === 0 ? "Keep until I delete" : `${days} days`;
}
