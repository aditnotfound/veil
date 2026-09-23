import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Textarea,
} from "@/components";
import { useApp } from "@/contexts";
import { fetchAIResponse } from "@/lib/functions";
import { ingestKnowledgeSource } from "@/lib/knowledge";
import { CheckCircle2, Loader2, MessageSquare, RotateCcw } from "lucide-react";

const AGENDA = [
  {
    id: "about-you",
    topic: "About you",
    tag: "about-you",
    hint: "identity, background, what they do, how they introduce themselves",
  },
  {
    id: "experience",
    topic: "Experience",
    tag: "experience",
    hint: "roles, years, domains, notable employers or freelance work",
  },
  {
    id: "projects",
    topic: "Projects",
    tag: "projects",
    hint: "flagship projects, what they built, impact, stack",
  },
  {
    id: "skills",
    topic: "Skills",
    tag: "skills",
    hint: "technical and soft skills, tools, strengths",
  },
  {
    id: "preferences",
    topic: "Preferences",
    tag: "preferences",
    hint: "work style, communication, tools, what they enjoy",
  },
  {
    id: "constraints",
    topic: "Constraints",
    tag: "constraints",
    hint: "limits, availability, things to avoid, non-negotiables",
  },
] as const;

type Phase = "idle" | "interviewing" | "done";
type TurnRole = "assistant" | "user" | "system";

interface ChatTurn {
  id: string;
  role: TurnRole;
  content: string;
}

const INTERVIEWER_SYSTEM = `You are a concise knowledge interviewer building a personal profile.
Rules:
- Ask one clear question at a time.
- Stay on the given topic.
- Be warm but minimal — dark, quiet chat tone; no filler, no lists of many questions.
- Do not dump multiple questions.
- Do not invent facts about the user.
- When judging if an answer needs a follow-up: only ask if it is thin, vague, or missing a key detail. Otherwise say NO_FOLLOWUP.`;

function newTurnId() {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function collectAIResponse(params: Parameters<typeof fetchAIResponse>[0]) {
  let full = "";
  for await (const chunk of fetchAIResponse(params)) {
    full += chunk;
  }
  return full.trim();
}

function isThinAnswer(answer: string) {
  const words = answer.trim().split(/\s+/).filter(Boolean);
  return words.length < 12 || answer.trim().length < 60;
}

export function Interview() {
  const { selectedAIProvider, allAiProviders } = useApp();
  const apiKey = selectedAIProvider?.variables?.api_key?.trim() || "";
  const provider = allAiProviders.find(
    (p) => p.id === selectedAIProvider.provider
  );

  const [phase, setPhase] = useState<Phase>("idle");
  const [topicIndex, setTopicIndex] = useState(0);
  const [awaitingFollowUp, setAwaitingFollowUp] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storedTopics, setStoredTopics] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isBusy]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const requireProvider = useCallback(() => {
    if (!apiKey) {
      throw new Error(
        "Select an AI provider with an API key before starting the interview."
      );
    }
    if (!selectedAIProvider.provider) {
      throw new Error("Select an AI provider in Dev space first.");
    }
  }, [apiKey, selectedAIProvider.provider]);

  const pushMessage = useCallback((role: TurnRole, content: string) => {
    setMessages((prev) => [...prev, { id: newTurnId(), role, content }]);
  }, []);

  const askTopicQuestion = useCallback(
    async (index: number) => {
      const item = AGENDA[index];
      if (!item) return;

      requireProvider();
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setIsBusy(true);
      setError(null);
      try {
        const question = await collectAIResponse({
          provider,
          selectedProvider: selectedAIProvider,
          systemPrompt: INTERVIEWER_SYSTEM,
          userMessage: `Topic: ${item.topic}
Focus: ${item.hint}
Write one short interview question for this topic. Output only the question text.`,
          signal: abortRef.current.signal,
        });

        const text =
          question ||
          `Tell me about your ${item.topic.toLowerCase()} — whatever feels most important.`;
        pushMessage("assistant", text);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Failed to generate question"
        );
      } finally {
        setIsBusy(false);
      }
    },
    [provider, pushMessage, requireProvider, selectedAIProvider]
  );

  const startInterview = async () => {
    try {
      requireProvider();
      setPhase("interviewing");
      setTopicIndex(0);
      setAwaitingFollowUp(false);
      setMessages([]);
      setDraft("");
      setStoredTopics([]);
      setError(null);
      pushMessage(
        "system",
        "Interview started. Answer in your own words — one topic at a time."
      );
      await askTopicQuestion(0);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start interview"
      );
      setPhase("idle");
    }
  };

  const finishInterview = (topics: string[]) => {
    setPhase("done");
    setAwaitingFollowUp(false);
    setStoredTopics(topics);
    pushMessage(
      "system",
      topics.length
        ? `Done. Stored ${topics.length} profile notes in your knowledge library.`
        : "Interview finished."
    );
  };

  const advanceOrFinish = async (
    nextIndex: number,
    topicsSoFar: string[]
  ) => {
    if (nextIndex >= AGENDA.length) {
      finishInterview(topicsSoFar);
      return;
    }
    setTopicIndex(nextIndex);
    setAwaitingFollowUp(false);
    await askTopicQuestion(nextIndex);
  };

  const maybeAskFollowUp = async (
    topic: (typeof AGENDA)[number],
    answer: string
  ): Promise<boolean> => {
    if (!isThinAnswer(answer)) return false;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const raw = await collectAIResponse({
      provider,
      selectedProvider: selectedAIProvider,
      systemPrompt: INTERVIEWER_SYSTEM,
      userMessage: `Topic: ${topic.topic}
User's answer:
"""
${answer}
"""
If this answer is thin or vague, ask exactly one short clarifying follow-up question.
If the answer is already solid, reply with exactly: NO_FOLLOWUP`,
      signal: abortRef.current.signal,
    });

    const cleaned = raw.replace(/^["']|["']$/g, "").trim();
    if (!cleaned || /^NO_FOLLOWUP\b/i.test(cleaned)) {
      return false;
    }

    pushMessage("assistant", cleaned);
    setAwaitingFollowUp(true);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const answer = draft.trim();
    if (!answer || isBusy || phase !== "interviewing") return;

    const topic = AGENDA[topicIndex];
    if (!topic) return;

    try {
      requireProvider();
      setIsBusy(true);
      setError(null);
      setDraft("");
      pushMessage("user", answer);

      const title = awaitingFollowUp
        ? `${topic.topic} (follow-up)`
        : topic.topic;

      await ingestKnowledgeSource({
        title,
        kind: "note",
        text: answer,
        tags: ["profile", topic.tag],
        apiKey: selectedAIProvider.provider === "openai" ? apiKey : "",
      });

      let topicsSoFar: string[] = [];
      setStoredTopics((prev) => {
        topicsSoFar = prev.includes(topic.topic)
          ? prev
          : [...prev, topic.topic];
        return topicsSoFar;
      });

      if (!awaitingFollowUp) {
        const asked = await maybeAskFollowUp(topic, answer);
        if (asked) {
          setIsBusy(false);
          return;
        }
      }

      setIsBusy(false);
      await advanceOrFinish(topicIndex + 1, topicsSoFar);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to save answer");
      setIsBusy(false);
    }
  };

  const currentTopic = AGENDA[topicIndex];

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {!apiKey && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            An AI provider API key is required for the interview. Configure one
            in Dev space.
          </p>
        </div>
      )}

      {phase === "idle" && (
        <Card className="border shadow-none p-6 gap-4 !bg-black/5 dark:!bg-white/5">
          <CardHeader className="p-0 space-y-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="size-4" />
              Knowledge Interview
            </CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              A short, guided chat about you — experience, projects, skills,
              preferences, and constraints. Each solid answer is saved as a
              tagged note in your library.
            </CardDescription>
          </CardHeader>
          <ul className="text-xs text-muted-foreground space-y-1.5 pl-1">
            {AGENDA.map((item) => (
              <li key={item.id}>· {item.topic}</li>
            ))}
          </ul>
          <Button
            type="button"
            onClick={startInterview}
            disabled={!apiKey || isBusy}
          >
            {isBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MessageSquare className="size-4" />
            )}
            Start interview
          </Button>
        </Card>
      )}

      {(phase === "interviewing" || phase === "done") && (
        <div className="flex flex-col border rounded-xl overflow-hidden bg-zinc-950/80 text-zinc-100 min-h-[28rem]">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {phase === "done"
                  ? "Interview complete"
                  : currentTopic
                    ? currentTopic.topic
                    : "Interview"}
              </p>
              <p className="text-xs text-zinc-400">
                {phase === "done"
                  ? `${storedTopics.length} topics stored`
                  : `Topic ${Math.min(topicIndex + 1, AGENDA.length)} of ${AGENDA.length}${
                      awaitingFollowUp ? " · follow-up" : ""
                    }`}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-zinc-300 hover:text-white hover:bg-white/10"
              onClick={startInterview}
              disabled={isBusy}
            >
              <RotateCcw className="size-3.5" />
              Restart
            </Button>
          </div>

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-4 space-y-3 max-h-[22rem]"
          >
            {messages.map((m) => {
              if (m.role === "system") {
                return (
                  <p
                    key={m.id}
                    className="text-center text-xs text-zinc-500 px-6"
                  >
                    {m.content}
                  </p>
                );
              }
              const isUser = m.role === "user";
              return (
                <div
                  key={m.id}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      isUser
                        ? "bg-zinc-100 text-zinc-900"
                        : "bg-zinc-800/90 text-zinc-100 border border-white/5"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              );
            })}
            {isBusy && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-3.5 py-2.5 bg-zinc-800/90 border border-white/5 text-zinc-400 text-sm inline-flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin" />
                  Thinking…
                </div>
              </div>
            )}
          </div>

          {phase === "interviewing" && (
            <form
              onSubmit={handleSubmit}
              className="border-t border-white/10 p-3 space-y-2"
            >
              <Textarea
                placeholder="Type your answer…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="min-h-20 bg-zinc-900/80 border-white/10 text-zinc-100 placeholder:text-zinc-500"
                disabled={isBusy}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSubmit(e);
                  }
                }}
              />
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={isBusy || !draft.trim()}
                  className="bg-zinc-100 text-zinc-900 hover:bg-white"
                >
                  {isBusy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Submit
                </Button>
              </div>
            </form>
          )}

          {phase === "done" && (
            <div className="border-t border-white/10 p-4 space-y-3">
              <p className="text-sm font-medium flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-400" />
                Topics stored
              </p>
              {storedTopics.length === 0 ? (
                <p className="text-xs text-zinc-500">No notes were saved.</p>
              ) : (
                <ul className="space-y-1.5">
                  {storedTopics.map((topic) => (
                    <li
                      key={topic}
                      className="text-sm text-zinc-300 flex items-center gap-2"
                    >
                      <span className="size-1.5 rounded-full bg-emerald-400/80" />
                      {topic}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
