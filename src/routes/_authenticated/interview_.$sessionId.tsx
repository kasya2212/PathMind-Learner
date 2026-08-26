import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CameraPreview } from "@/components/CameraPreview";
import { InterviewAnswerInput } from "@/components/InterviewAnswerInput";
import { isSpeechSynthesisSupported } from "@/components/VoiceControls";
import { Badge, Button, Card, EmptyState, ErrorState, InlineLoading, Skeleton } from "@/components/Primitives";
import {
  completeInterviewSession,
  openInterviewSession,
  submitInterviewAnswer,
} from "@/lib/interview.functions";
import {
  INTERVIEW_MAX_LEARNER_TURNS,
  type InterviewTurn,
} from "@/lib/interview.shared";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/interview_/$sessionId")({
  head: () => ({
    meta: [
      { title: "Mock Interview — PathMind" },
      {
        name: "description",
        content: "Your live AI mock interview — voice or typed answers with a private camera self-view.",
      },
      { property: "og:title", content: "Mock Interview — PathMind" },
      {
        property: "og:description",
        content: "Your live AI mock interview — voice or typed answers with a private camera self-view.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InterviewLivePage,
});

/** Light markdown strip so spoken interviewer messages sound natural. */
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
function friendlyInterviewError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  const KNOWN = [
    "characters",
    "busy right now",
    "credits",
    "isn't available",
    "isn't configured",
    "rephrasing",
    "longer than expected",
    "couldn't save",
    "couldn't load",
    "couldn't open",
    "couldn't start",
    "could not be found",
    "already ended",
    "has expired",
    "couldn't be generated",
    "Say or type",
    "at least one answer",
  ];
  if (KNOWN.some((k) => msg.includes(k))) return msg;
  return "PathMind is taking longer than expected. Please try again.";
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function InterviewLivePage() {
  const { sessionId } = Route.useParams();
  const navigate = useNavigate();

  const openFn = useServerFn(openInterviewSession);
  const submitFn = useServerFn(submitInterviewAnswer);
  const completeFn = useServerFn(completeInterviewSession);

  const [turns, setTurns] = useState<InterviewTurn[] | null>(null);
  const [sending, setSending] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryText, setRetryText] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const lastSentRef = useRef<{ text: string; at: number } | null>(null);
  const lastSpokenRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const synthSupported = useMemo(() => isSpeechSynthesisSupported(), []);

  /* ------------------------------ load/resume --------------------------- */

  const openQuery = useQuery({
    queryKey: ["interview-open", sessionId],
    queryFn: () => openFn({ data: { session_id: sessionId } }),
    staleTime: Infinity,
    gcTime: 0,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const session = openQuery.data?.session ?? null;

  // Seed local turns from the open response (refresh-resume replays history).
  useEffect(() => {
    if (openQuery.data && turns === null) setTurns(openQuery.data.turns);
  }, [openQuery.data, turns]);

  // A completed session belongs on the results screen.
  useEffect(() => {
    if (session?.status === "completed") {
      navigate({ to: "/interview/$sessionId/results", params: { sessionId }, replace: true });
    }
  }, [session?.status, sessionId, navigate]);

  /* ----------------------------- speech out ----------------------------- */

  function stopSpeaking() {
    if (synthSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  function speakText(text: string) {
    if (!synthSupported || !text) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(toSpeechText(text));
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  }

  // Read each new interviewer message aloud (toggleable).
  useEffect(() => {
    if (!voiceOn || !synthSupported || !turns?.length) return;
    const last = turns[turns.length - 1];
    if (!last || last.role !== "interviewer" || lastSpokenRef.current === last.id) return;
    lastSpokenRef.current = last.id;
    speakText(last.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, voiceOn, synthSupported]);

  useEffect(
    () => () => {
      if (isSpeechSynthesisSupported()) window.speechSynthesis.cancel();
    },
    [],
  );

  /* ------------------------------ timer --------------------------------- */

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const learnerTurns = (turns ?? []).filter((t) => t.role === "learner").length;
  const elapsedSec = session
    ? Math.max(0, Math.floor((now - new Date(session.started_at).getTime()) / 1000))
    : 0;
  const totalSec = (session?.config.durationMinutes ?? 25) * 60;
  const remainingSec = Math.max(0, totalSec - elapsedSec);
  const timeUp = remainingSec <= 0;

  /* ------------------------------ scroll -------------------------------- */

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, sending]);

  /* ---------------------------- completion ------------------------------ */

  async function runCompletion() {
    if (finishing) return;
    stopSpeaking();
    setFinishing(true);
    setError(null);
    try {
      const res = await completeFn({ data: { session_id: sessionId } });
      if (res.evaluation) {
        navigate({ to: "/interview/$sessionId/results", params: { sessionId } });
        return;
      }
      setError("We need at least one answer before writing your evaluation.");
    } catch (e) {
      setError(friendlyInterviewError(e));
    } finally {
      setFinishing(false);
      setConfirmEnd(false);
    }
  }

  /* ------------------------------ sending ------------------------------- */

  async function handleSend(raw: string) {
    const text = raw.trim();
    if (!text || sending || finishing) return;
    // Frontend duplicate guard: ignore identical resubmits within 3s.
    const nowMs = Date.now();
    if (lastSentRef.current && lastSentRef.current.text === text && nowMs - lastSentRef.current.at < 3000) {
      return;
    }
    lastSentRef.current = { text, at: nowMs };

    stopSpeaking();
    setError(null);
    setRetryText(null);
    setSending(true);
    const optimisticId = `optimistic-${nowMs}`;
    setTurns((prev) => [
      ...(prev ?? []),
      { id: optimisticId, role: "learner", content: text, created_at: new Date(nowMs).toISOString() },
    ]);

    try {
      const result = await submitFn({ data: { session_id: sessionId, text } });
      if (result.turn) setTurns((prev) => [...(prev ?? []), result.turn!]);
      if (result.finished) {
        await runCompletion();
      }
    } catch (e) {
      // The answer may already be persisted — keep it visible, offer retry.
      setError(friendlyInterviewError(e));
      setRetryText(text);
    } finally {
      setSending(false);
    }
  }

  /* ------------------------------ render -------------------------------- */

  const currentQuestion = useMemo(() => {
    if (!turns) return null;
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      if (turns[i]!.role === "interviewer") return turns[i]!.content;
    }
    return null;
  }, [turns]);

  const interviewerState = speaking ? "speaking" : sending ? "thinking" : "waiting";

  return (
    <AppShell
      title={session ? `Mock interview — ${session.config.targetRole}` : "AI Interview"}
      subtitle="Answer out loud or type. Your camera is a private self-view — nothing is uploaded."
      actions={
        session?.status === "in_progress" ? (
          <div className="flex items-center gap-2">
            {synthSupported ? (
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={voiceOn}
                onClick={() => {
                  if (voiceOn) stopSpeaking();
                  setVoiceOn((v) => !v);
                }}
              >
                {voiceOn ? "🔊 Voice on" : "🔇 Voice off"}
              </Button>
            ) : null}
            {confirmEnd ? (
              <>
                <Button variant="danger" size="sm" onClick={runCompletion} disabled={finishing}>
                  {finishing ? "Writing evaluation…" : "Confirm finish"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmEnd(false)} disabled={finishing}>
                  Keep going
                </Button>
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setConfirmEnd(true)}>
                End interview
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {openQuery.isPending ? (
        <Card className="px-6 py-10">
          <InlineLoading label="Preparing your interview…" />
          <div className="mt-6 space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </Card>
      ) : openQuery.isError || !session ? (
        <ErrorState
          message={friendlyInterviewError(openQuery.error)}
          onRetry={() => openQuery.refetch()}
        />
      ) : session.status === "expired" || session.status === "abandoned" ? (
        <EmptyState
          title={session.status === "expired" ? "This interview has expired" : "This interview has ended"}
          description="Interview sessions stay open for a few hours. Start a fresh one whenever you're ready."
          action={
            <Link to="/interview">
              <Button variant="primary">Back to interview setup</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            {openQuery.data?.resumed && learnerTurns > 0 ? (
              <p className="rounded-xl border border-border bg-primary-soft/50 px-4 py-2.5 text-xs text-foreground">
                Continuing your interview — everything so far is saved.
              </p>
            ) : null}

            {timeUp ? (
              <p className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-2.5 text-sm text-warning-foreground">
                Time's up — finish your current thought, then tap <strong>End interview</strong> for your evaluation.
              </p>
            ) : null}

            {/* Interviewer */}
            <Card>
              <div className="flex items-start gap-4 px-5 py-5 sm:px-6">
                <InterviewerAvatar state={interviewerState} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">Your interviewer</p>
                    <Badge tone="primary">
                      {session.config.interviewType === "mixed"
                        ? "Mixed"
                        : session.config.interviewType === "technical"
                          ? "Technical"
                          : "Behavioral"}
                    </Badge>
                    <Badge tone="neutral">
                      {session.config.difficulty === "foundation"
                        ? "Foundational"
                        : session.config.difficulty === "advanced"
                          ? "Advanced"
                          : "Intermediate"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground" role="status">
                    {interviewerState === "speaking"
                      ? "Speaking…"
                      : interviewerState === "thinking"
                        ? "Thinking…"
                        : "Your turn"}
                  </p>
                  <p className="mt-3 text-base leading-relaxed text-foreground">
                    {currentQuestion ?? "Getting the first question ready…"}
                  </p>
                </div>
              </div>
            </Card>

            {/* Transcript */}
            <Card>
              <div className="border-b border-border px-5 py-3">
                <h2 className="text-sm font-semibold text-foreground">Transcript</h2>
              </div>
              <div ref={scrollRef} className="max-h-[340px] space-y-3 overflow-y-auto px-5 py-4">
                {(turns ?? []).map((t) => (
                  <div
                    key={t.id}
                    className={cn("flex", t.role === "learner" ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                        t.role === "learner"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-foreground",
                      )}
                    >
                      {t.content}
                    </div>
                  </div>
                ))}
                {sending ? (
                  <div className="flex justify-start">
                    <div className="rounded-2xl bg-secondary px-4 py-2.5 text-sm text-muted-foreground">
                      …
                    </div>
                  </div>
                ) : null}
              </div>
            </Card>

            {/* Answer composer */}
            <Card>
              <div className="border-b border-border px-5 py-3">
                <h2 className="text-sm font-semibold text-foreground">Your answer</h2>
              </div>
              <InterviewAnswerInput sending={sending} disabled={finishing} onSend={handleSend} />
              {error ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                  {retryText ? (
                    <Button variant="secondary" size="sm" onClick={() => handleSend(retryText)}>
                      Retry
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </Card>
          </div>

          {/* Right rail */}
          <div className="min-w-0 space-y-6 lg:sticky lg:top-24 lg:self-start">
            <Card>
              <CameraPreview />
            </Card>

            <Card>
              <div className="space-y-4 px-5 py-5">
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Time left
                    </p>
                    <p
                      className={cn(
                        "text-lg font-semibold tabular-nums",
                        timeUp ? "text-warning-foreground" : "text-foreground",
                      )}
                    >
                      {formatClock(remainingSec)}
                    </p>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-1000"
                      style={{ width: `${Math.min(100, (remainingSec / totalSec) * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground">Answers given</p>
                  <p className="text-sm font-medium tabular-nums text-foreground">
                    {learnerTurns} of up to {INTERVIEW_MAX_LEARNER_TURNS}
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Evaluation</p>
                  <p className="text-sm text-foreground">Written at the end</p>
                </div>
              </div>
            </Card>

            <Card>
              <div className="px-5 py-4">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Tips: answer out loud like a real interview; ask yourself "what would I build,
                  measure, or change?"; it's fine to say "I don't know" — the interviewer adapts.
                </p>
              </div>
            </Card>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function InterviewerAvatar({ state }: { state: "speaking" | "thinking" | "waiting" }) {
  return (
    <div className="relative shrink-0">
      {state === "speaking" ? (
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" aria-hidden="true" />
      ) : null}
      <div
        className={cn(
          "grid h-14 w-14 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground transition-opacity",
          state === "thinking" && "opacity-70",
        )}
        aria-hidden="true"
      >
        PM
      </div>
    </div>
  );
}
