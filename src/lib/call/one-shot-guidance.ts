import { MAX_LIVE_GUIDANCE_CHARS } from "./decision-router.ts";

/** User guidance is applied to exactly one automatic answer attempt. */
export class OneShotGuidance {
  private pending = "";

  queue(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return this.pending;
    this.pending = trimmed.slice(0, MAX_LIVE_GUIDANCE_CHARS);
    return this.pending;
  }

  take(): string {
    const value = this.pending;
    this.pending = "";
    return value;
  }

  clear(): void {
    this.pending = "";
  }
}
