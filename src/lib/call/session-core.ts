export type CallSource = "system" | "mic";

export interface FinalUtterance {
  id: string;
  sessionId: string;
  source: CallSource;
  sequence: number;
  startedAt: number;
  endedAt: number;
  text: string;
}

export interface AnswerJob {
  signal: AbortSignal;
  isCurrent: () => boolean;
}

const MAX_HISTORY_UTTERANCES = 24;
const MAX_HISTORY_CHARS = 8000;

/** Session state is independent of React renders and network completion order. */
export class CallSessionCore {
  private sessionId = "";
  private generation = 0;
  private controller: AbortController | null = null;
  private utterances: FinalUtterance[] = [];
  private seen = new Set<string>();

  start(sessionId: string): void {
    this.stop();
    this.sessionId = sessionId;
  }

  stop(): void {
    this.cancelAnswer();
    this.sessionId = "";
    this.utterances = [];
    this.seen.clear();
  }

  get activeSessionId(): string {
    return this.sessionId;
  }

  appendFinal(utterance: FinalUtterance): boolean {
    if (!this.sessionId || utterance.sessionId !== this.sessionId) return false;
    const text = utterance.text.trim();
    if (!text || !Number.isFinite(utterance.sequence)) return false;
    const key = `${utterance.source}:${utterance.sequence}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.utterances.push({ ...utterance, text });
    return true;
  }

  orderedUtterances(): FinalUtterance[] {
    return [...this.utterances].sort(
      (a, b) =>
        a.startedAt - b.startedAt ||
        a.endedAt - b.endedAt ||
        a.source.localeCompare(b.source) ||
        a.sequence - b.sequence
    );
  }

  historyBefore(id: string): { role: "user"; content: string }[] {
    return this.historyEntriesBefore(id).map(({ role, content }) => ({ role, content }));
  }

  historyEntriesBefore(id: string): { id: string; role: "user"; content: string }[] {
    const ordered = this.orderedUtterances();
    const pivot = ordered.findIndex((utterance) => utterance.id === id);
    const earlier = pivot < 0 ? ordered : ordered.slice(0, pivot);
    const recent: { id: string; role: "user"; content: string }[] = [];
    let chars = 0;
    for (let i = earlier.length - 1; i >= 0 && recent.length < MAX_HISTORY_UTTERANCES; i--) {
      const utterance = earlier[i];
      const content = `${utterance.source === "mic" ? "Mic" : "System"}: ${utterance.text}`;
      if (chars + content.length > MAX_HISTORY_CHARS) break;
      recent.push({ id: utterance.id, role: "user", content });
      chars += content.length;
    }
    return recent.reverse();
  }

  beginAnswer(): AnswerJob {
    this.cancelAnswer();
    const generation = this.generation;
    const sessionId = this.sessionId;
    const controller = new AbortController();
    this.controller = controller;
    return {
      signal: controller.signal,
      isCurrent: () =>
        !!sessionId &&
        this.sessionId === sessionId &&
        this.generation === generation &&
        !controller.signal.aborted,
    };
  }

  cancelAnswer(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
  }
}
