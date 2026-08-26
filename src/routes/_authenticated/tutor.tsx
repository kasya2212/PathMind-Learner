import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { AppShell } from "@/components/AppShell";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/Primitives";
import {
  getRecognitionCtor,
  isSpeechSynthesisSupported,
  VoiceControls,
} from "@/components/VoiceControls";
import { useAuth } from "@/lib/auth";
import {
  createTutorConversation,
  deleteTutorConversation,
  getTutorContext,
  getTutorMessages,
  listTutorConversations,
  sendTutorMessage,
} from "@/lib/tutor.functions";
import {
  TUTOR_MESSAGE_MAX,
  type TutorConversationSummary,
  type TutorLearnerContext,
  type TutorMessage,
} from "@/lib/tutor.shared";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/tutor")({
  head: () => ({
    meta: [
      { title: "AI Tutor — PathMind" },
      {
        name: "description",
        content:
          "Chat or talk with your personalized PathMind AI Tutor — explanations, hints, quizzes and guidance grounded in your real learning path.",
      },
      { property: "og:title", content: "AI Tutor — PathMind" },
      {
        property: "og:description",
        content:
          "Chat or talk with your personalized PathMind AI Tutor — explanations, hints, quizzes and guidance grounded in your real learning path.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TutorPage,
});

const SUGGESTIONS = [
  "What should I learn next?",
  "Quiz me on my current skill",
  "Why am I learning this?",
  "Explain my next step simply",
];

/** Very light markdown strip so spoken replies sound natural. */
function toSpeechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " code example ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map any error to a calm, learner-facing message — never raw internals. */
function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  const KNOWN = [
    "characters",
    "busy right now",
    "credits",
    "isn't available",
    "isn't configured",
    "rephrasing",
    "longer than expected",
    "rate-limited",
    "temporarily unavailable",
    "quota",
    "couldn't save",
    "couldn't load",
    "couldn't open",
    "could not be found",
    "couldn't start",
    "Type a message",
  ];
  if (KNOWN.some((k) => msg.includes(k))) return msg;
  return "PathMind is taking longer than expected. Please try again.";
}

/* ---------------------------------------------------------------------- */

function TutorPage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();

  const listConversationsFn = useServerFn(listTutorConversations);
  const getMessagesFn = useServerFn(getTutorMessages);
  const createConversationFn = useServerFn(createTutorConversation);
  const deleteConversationFn = useServerFn(deleteTutorConversation);
  const getContextFn = useServerFn(getTutorContext);
  const sendMessageFn = useServerFn(sendTutorMessage);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [retryText, setRetryText] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [speaking, setSpeaking] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [pathOpen, setPathOpen] = useState(false);

  const lastSentRef = useRef<{ text: string; at: number } | null>(null);
  const creatingConversationRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const recognitionSupported = useMemo(() => Boolean(getRecognitionCtor()), []);
  const synthSupported = useMemo(() => isSpeechSynthesisSupported(), []);

  /* ------------------------------ data --------------------------------- */

  const conversationsQuery = useQuery({
    queryKey: ["tutor-conversations", userId],
    queryFn: () => listConversationsFn(),
    enabled: Boolean(userId),
  });
  const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);

  // Open the most recent conversation by default; never create on load.
  useEffect(() => {
    if (!activeId && conversations.length) setActiveId(conversations[0]!.id);
  }, [activeId, conversations]);

  const messagesQuery = useQuery({
    queryKey: ["tutor-messages", activeId],
    queryFn: () => getMessagesFn({ data: { conversation_id: activeId! } }),
    enabled: Boolean(activeId),
  });
  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);

  // "Your Path" panel — same shared learner context the Tutor prompt uses.
  const contextQuery = useQuery({
    queryKey: ["tutor-context", userId],
    queryFn: () => getContextFn(),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });

  /* --------------------------- speech out ------------------------------ */

  function stopSpeaking() {
    if (synthSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  function speak(text: string) {
    if (!synthSupported || !text) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(toSpeechText(text));
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  }

  useEffect(
    () => () => {
      if (isSpeechSynthesisSupported()) window.speechSynthesis.cancel();
    },
    [],
  );

  /* ----------------------------- sending -------------------------------- */

  async function handleSend(raw: string, opts?: { voice?: boolean }) {
    const text = raw.trim();
    if (!text || sending) return;
    if (text.length > TUTOR_MESSAGE_MAX) {
      setSendError(
        `That message is a little long. Try shortening it to ${TUTOR_MESSAGE_MAX.toLocaleString()} characters.`,
      );
      return;
    }
    // Frontend duplicate guard: ignore identical resubmits within 3s.
    const now = Date.now();
    if (
      lastSentRef.current &&
      lastSentRef.current.text === text &&
      now - lastSentRef.current.at < 3000
    ) {
      return;
    }
    lastSentRef.current = { text, at: now };

    stopSpeaking();
    setSendError(null);
    setRetryText(null);
    setSending(true);
    setOptimistic(text);

    try {
      let convId = activeId;
      if (!convId) {
        if (creatingConversationRef.current) return;
        creatingConversationRef.current = true;
        try {
          // Explicit action (sending a first message) creates the conversation.
          const convo = await createConversationFn();
          convId = convo.id;
          setActiveId(convo.id);
        } finally {
          creatingConversationRef.current = false;
        }
      }
      const result = await sendMessageFn({
        data: { conversation_id: convId, text },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tutor-messages", convId] }),
        queryClient.invalidateQueries({ queryKey: ["tutor-conversations", userId] }),
      ]);
      if (opts?.voice) speak(result.message.content);
    } catch (e) {
      // The learner message may already be persisted — reload so the UI shows
      // exactly what the server holds instead of pretending the AI answered.
      if (activeId) {
        await queryClient.invalidateQueries({ queryKey: ["tutor-messages", activeId] });
      }
      setSendError(friendlyError(e));
      setRetryText(text);
    } finally {
      setSending(false);
      setOptimistic(null);
    }
  }

  async function handleNewConversation() {
    if (creatingConversationRef.current) return;
    creatingConversationRef.current = true;
    try {
      const convo = await createConversationFn();
      setActiveId(convo.id);
      setSendError(null);
      setRetryText(null);
      await queryClient.invalidateQueries({ queryKey: ["tutor-conversations", userId] });
    } finally {
      creatingConversationRef.current = false;
    }
  }

  async function handleDelete(conversationId: string) {
    await deleteConversationFn({ data: { conversation_id: conversationId } });
    if (activeId === conversationId) setActiveId(null);
    await queryClient.invalidateQueries({ queryKey: ["tutor-conversations", userId] });
  }

  /* ----------------------------- rendering ------------------------------ */

  const displayMessages: TutorMessage[] = useMemo(() => {
    const base = [...messages];
    if (optimistic) {
      base.push({ id: "pending-user", role: "user", content: optimistic, created_at: "" });
    }
    return base;
  }, [messages, optimistic]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [displayMessages.length, sending]);

  const overLimit = draft.length > TUTOR_MESSAGE_MAX;

  return (
    <AppShell
      title="AI Tutor"
      subtitle="A tutor that knows your goal, your skills, and your plan."
      actions={
        <Button type="button" variant="secondary" onClick={handleNewConversation}>
          New conversation
        </Button>
      }
    >
      {/* Mobile: Your Path as a compact expandable section */}
      <div className="mb-4 lg:hidden">
        <button
          type="button"
          onClick={() => setPathOpen((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between rounded-xl border border-border bg-surface px-4 text-sm font-medium text-foreground"
          aria-expanded={pathOpen}
        >
          Your Path
          <span aria-hidden="true" className={cn("transition-transform", pathOpen && "rotate-180")}>
            ▾
          </span>
        </button>
        {pathOpen ? (
          <div className="mt-2">
            <YourPathPanel contextQuery={contextQuery} />
            <ConversationList
              conversations={conversations}
              activeId={activeId}
              onSelect={setActiveId}
              onDelete={handleDelete}
            />
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ------------------------- Conversation ------------------------- */}
        <Card className="flex min-w-0 flex-col overflow-hidden">
          {/* mode toggle */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex rounded-lg border border-border p-0.5 text-xs">
              {(["text", "voice"] as const).map((m) => {
                const disabled = m === "voice" && !recognitionSupported;
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={disabled}
                    title={disabled ? "Voice isn't supported in this browser" : undefined}
                    onClick={() => {
                      stopSpeaking();
                      setMode(m);
                    }}
                    className={cn(
                      "min-h-9 rounded-md px-3 capitalize transition-colors",
                      mode === m
                        ? "bg-primary font-medium text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                      disabled && "cursor-not-allowed opacity-40",
                    )}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
            {activeId ? (
              <span className="text-xs text-muted-foreground">
                {messages.length} message{messages.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          {voiceNotice ? (
            <div className="border-b border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
              {voiceNotice}
            </div>
          ) : null}

          {/* messages */}
          <div
            ref={scrollRef}
            className="h-[46dvh] min-h-72 overflow-y-auto px-4 py-4 lg:h-[calc(100dvh-21rem)]"
          >
            {messagesQuery.isPending && activeId ? (
              <div className="space-y-3">
                <Skeleton className="h-14 w-2/3" />
                <Skeleton className="ml-auto h-10 w-1/2" />
              </div>
            ) : displayMessages.length === 0 ? (
              <EmptyState
                title="Ask your tutor anything"
                description="Explanations, hints, quizzes, or why a skill is on your path — grounded in your real progress."
              />
            ) : (
              <ol className="flex flex-col gap-3">
                {displayMessages.map((m) => (
                  <MessageBubble key={m.id} message={m} pending={m.id === "pending-user"} />
                ))}
                {sending ? (
                  <li className="mr-auto flex max-w-[85%] items-center gap-2 rounded-2xl rounded-tl-sm border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-primary" />
                    Thinking…
                  </li>
                ) : null}
              </ol>
            )}
          </div>

          {/* suggestion chips on empty conversation */}
          {displayMessages.length === 0 && !messagesQuery.isPending ? (
            <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleSend(s, { voice: mode === "voice" })}
                  className="min-h-9 rounded-full border border-border bg-surface px-3 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          {/* error + retry */}
          {sendError ? (
            <div className="flex items-center justify-between gap-3 border-t border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
              <span className="min-w-0">{sendError}</span>
              {retryText ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={sending}
                  onClick={() => handleSend(retryText, { voice: mode === "voice" })}
                >
                  Retry
                </Button>
              ) : null}
            </div>
          ) : null}

          {/* composer */}
          <div className="border-t border-border p-3">
            {mode === "voice" && recognitionSupported ? (
              <VoiceControls
                busy={sending}
                speaking={speaking}
                onSend={(text) => handleSend(text, { voice: true })}
                onStopSpeaking={stopSpeaking}
                onPermissionDenied={() => {
                  setMode("text");
                  setVoiceNotice("Microphone access isn't available. You can continue by typing.");
                }}
              />
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!overLimit) {
                    void handleSend(draft);
                    setDraft("");
                  }
                }}
                className="flex items-end gap-2"
              >
                <div className="min-w-0 flex-1">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!overLimit && draft.trim()) {
                          void handleSend(draft);
                          setDraft("");
                        }
                      }
                    }}
                    rows={2}
                    placeholder="Ask for an explanation, a hint, or a quick quiz…"
                    className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  />
                  <div className="mt-1 flex items-center justify-between px-1 text-[11px]">
                    <span className="text-muted-foreground">
                      {mode === "text" && !recognitionSupported
                        ? "Voice isn't supported in this browser — text works everywhere."
                        : "Enter to send · Shift+Enter for a new line"}
                    </span>
                    <span
                      className={cn(
                        overLimit ? "font-medium text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {draft.length.toLocaleString()}/{TUTOR_MESSAGE_MAX.toLocaleString()}
                    </span>
                  </div>
                  {overLimit ? (
                    <p className="px-1 text-[11px] text-destructive">
                      That message is a little long. Try shortening it to{" "}
                      {TUTOR_MESSAGE_MAX.toLocaleString()} characters.
                    </p>
                  ) : null}
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={sending || !draft.trim() || overLimit}
                >
                  Send
                </Button>
              </form>
            )}
          </div>
        </Card>

        {/* ------------------------- Right rail --------------------------- */}
        <aside className="sticky top-24 hidden min-w-0 space-y-4 lg:block">
          <YourPathPanel contextQuery={contextQuery} />
          <ConversationList
            conversations={conversations}
            activeId={activeId}
            onSelect={setActiveId}
            onDelete={handleDelete}
          />
        </aside>
      </div>
    </AppShell>
  );
}

/* ---------------------------------------------------------------------- */

const mdComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="my-1.5 leading-relaxed first:mt-0 last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-secondary px-1 py-0.5 text-[0.85em]">{children}</code>
  ),
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-secondary p-3 text-xs">{children}</pre>
  ),
};

function MessageBubble({ message, pending }: { message: TutorMessage; pending?: boolean }) {
  const isUser = message.role === "user";
  return (
    <li
      className={cn(
        "max-w-[85%] px-4 py-3 text-sm",
        isUser
          ? "ml-auto rounded-2xl rounded-tr-sm bg-primary text-primary-foreground"
          : "mr-auto rounded-2xl rounded-tl-sm border border-border bg-surface text-foreground",
        pending && "opacity-70",
      )}
    >
      {!isUser ? (
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          PathMind Tutor
        </p>
      ) : null}
      <div className={cn("break-words", isUser && "whitespace-pre-wrap")}>
        {isUser ? (
          message.content
        ) : (
          <ReactMarkdown components={mdComponents}>{message.content}</ReactMarkdown>
        )}
      </div>
    </li>
  );
}

/* --------------------------- Your Path panel ---------------------------- */

type ContextQuery = {
  data: TutorLearnerContext | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
};

function YourPathPanel({ contextQuery }: { contextQuery: ContextQuery }) {
  const ctx = contextQuery.data;
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">Your Path</h2>
      {contextQuery.isPending ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : contextQuery.isError || !ctx ? (
        <ErrorState message="Couldn't load your path." onRetry={() => contextQuery.refetch()} />
      ) : !ctx.goalText && !ctx.goalName ? (
        <div className="mt-3">
          <EmptyState
            title="No goal yet"
            description="Set a goal so your tutor can ground every answer in your path."
          />
          <Link to="/" className="mt-2 block">
            <Button type="button" variant="secondary" className="w-full">
              Set your goal
            </Button>
          </Link>
        </div>
      ) : (
        <div className="mt-3 space-y-4 text-sm">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Current goal
            </p>
            <p className="mt-1 font-medium text-foreground">{ctx.goalText ?? ctx.goalName}</p>
          </div>
          {ctx.nextStep ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Next recommended skill
              </p>
              <p className="mt-1 font-medium text-foreground">{ctx.nextStep.name}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {ctx.nextStep.why}
              </p>
            </div>
          ) : null}
          {ctx.inProgress.length ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Focus skills
              </p>
              <ul className="mt-1.5 space-y-1">
                {ctx.inProgress.slice(0, 3).map((s) => (
                  <li key={s.name} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-foreground">{s.name}</span>
                    <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary">
                      {s.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {ctx.fading.length ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Due for review
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {ctx.fading.map((n) => (
                  <span
                    key={n}
                    className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                  >
                    {n}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {ctx.hiddenGaps.length ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Hidden gaps
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {ctx.hiddenGaps.map((n) => (
                  <span
                    key={n}
                    className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    {n}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {ctx.upcoming.length ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Up next on your plan
              </p>
              <ol className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                {ctx.upcoming.slice(0, 3).map((p) => (
                  <li key={p.name} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {p.isGap ? "⚠ " : ""}
                      {p.name}
                    </span>
                    <span className="shrink-0">~{p.minutes}m</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/* ------------------------- Conversation list ---------------------------- */

function ConversationList({
  conversations,
  activeId,
  onSelect,
  onDelete,
}: {
  conversations: TutorConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!conversations.length) return null;
  return (
    <Card className="p-3">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Conversations
      </h2>
      <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
        {conversations.map((c) => {
          const when = new Date(c.last_message_at ?? c.created_at);
          return (
            <li key={c.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                className={cn(
                  "min-h-10 min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-left transition-colors",
                  activeId === c.id ? "bg-primary-soft" : "hover:bg-secondary",
                )}
              >
                <span className="block truncate text-xs font-medium text-foreground">
                  {c.preview ?? "New conversation"}
                </span>
                <span className="block text-[10px] text-muted-foreground">
                  {when.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  {" · "}
                  {when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                </span>
              </button>
              <button
                type="button"
                aria-label="Delete conversation"
                onClick={() => onDelete(c.id)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-destructive group-hover:opacity-100"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
