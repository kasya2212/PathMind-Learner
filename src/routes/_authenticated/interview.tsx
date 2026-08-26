import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, Field, inputClass, Skeleton } from "@/components/Primitives";
import { useAuth } from "@/lib/auth";
import {
  abandonInterviewSession,
  listInterviewSessions,
  startInterviewSession,
} from "@/lib/interview.functions";
import {
  INTERVIEW_DIFFICULTIES,
  INTERVIEW_MAX_LEARNER_TURNS,
  INTERVIEW_TYPES,
  type InterviewConfig,
  type InterviewDifficulty,
  type InterviewSessionSummary,
  type InterviewType,
} from "@/lib/interview.shared";
import { fetchProfile } from "@/lib/pathmind";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/interview")({
  head: () => ({
    meta: [
      { title: "AI Interview — PathMind" },
      {
        name: "description",
        content:
          "Run a realistic mock interview with an adaptive AI interviewer grounded in your real PathMind skill profile — voice or typed answers, camera self-view, written evaluation.",
      },
      { property: "og:title", content: "AI Interview — PathMind" },
      {
        property: "og:description",
        content:
          "Run a realistic mock interview with an adaptive AI interviewer grounded in your real PathMind skill profile.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InterviewSetupPage,
});

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  const KNOWN = ["couldn't", "could not be found", "isn't", "credits", "busy right now", "longer than expected"];
  if (KNOWN.some((k) => msg.includes(k))) return msg;
  return "PathMind is taking longer than expected. Please try again.";
}

const DURATIONS = [
  { value: 15, label: "15 min", hint: "Quick practice" },
  { value: 25, label: "25 min", hint: "A solid session" },
  { value: 40, label: "40 min", hint: "Deep preparation" },
] as const;

function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string; hint?: string }[];
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-11 rounded-xl border px-3 py-2.5 text-left transition-colors",
            value === o.value
              ? "border-primary bg-primary-soft"
              : "border-border bg-card hover:bg-secondary",
          )}
        >
          <span className="block text-sm font-medium text-foreground">{o.label}</span>
          {o.hint ? (
            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{o.hint}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  in_progress: "In progress",
  completed: "Completed",
  abandoned: "Ended early",
  expired: "Expired",
};

function InterviewSetupPage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const listFn = useServerFn(listInterviewSessions);
  const startFn = useServerFn(startInterviewSession);
  const abandonFn = useServerFn(abandonInterviewSession);

  const [targetRole, setTargetRole] = useState("");
  const [interviewType, setInterviewType] = useState<InterviewType>("mixed");
  const [difficulty, setDifficulty] = useState<InterviewDifficulty>("intermediate");
  const [duration, setDuration] = useState<number>(25);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roleTouched = useRef(false);

  const sessionsQuery = useQuery({
    queryKey: ["interview-sessions", userId],
    queryFn: () => listFn(),
    enabled: Boolean(userId),
  });
  const sessions = sessionsQuery.data ?? [];
  const active = sessions.find((s) => s.status === "in_progress") ?? null;

  // Prefill the target role from the learner's real goal (editable).
  const profileQuery = useQuery({
    queryKey: ["interview-profile", userId],
    queryFn: () => fetchProfile(userId),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });
  useEffect(() => {
    const goal = profileQuery.data?.goal_text;
    if (goal && !roleTouched.current) setTargetRole(goal);
  }, [profileQuery.data]);

  async function handleStart() {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const config: InterviewConfig = {
        targetRole,
        interviewType,
        difficulty,
        durationMinutes: duration,
      };
      const res = await startFn({ data: { config } });
      navigate({ to: "/interview/$sessionId", params: { sessionId: res.session.id } });
    } catch (e) {
      setError(friendlyError(e));
      setStarting(false);
    }
  }

  async function handleAbandon(sessionId: string) {
    try {
      await abandonFn({ data: { session_id: sessionId } });
      await queryClient.invalidateQueries({ queryKey: ["interview-sessions", userId] });
    } catch {
      /* non-fatal — the list will refresh on next load */
    }
  }

  return (
    <AppShell
      title="AI Interview"
      subtitle="A realistic mock interview that adapts to your actual skill profile."
    >
      {active ? (
        <Card className="mb-6 border-warning/40 bg-warning-soft/40">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                You have an interview in progress — {active.config.targetRole}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Started {new Date(active.started_at).toLocaleString()} · your answers so far are saved.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() =>
                  navigate({ to: "/interview/$sessionId", params: { sessionId: active.id } })
                }
              >
                Continue interview
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleAbandon(active.id)}>
                End it
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader
            title="Set up your interview"
            subtitle="Your interviewer adapts its questions to your real strengths, weak spots and current focus."
          />
          <div className="space-y-6 px-5 pb-6 pt-2 sm:px-6">
            <Field
              label="Target role"
              hint="What position should this interview prepare you for?"
              htmlFor="target-role"
            >
              <input
                id="target-role"
                value={targetRole}
                onChange={(e) => {
                  roleTouched.current = true;
                  setTargetRole(e.target.value.slice(0, 120));
                }}
                placeholder="e.g. Java Backend Developer"
                className={inputClass}
                maxLength={120}
              />
            </Field>

            <Field label="Interview type">
              <Segmented<InterviewType>
                ariaLabel="Interview type"
                value={interviewType}
                onChange={setInterviewType}
                options={INTERVIEW_TYPES}
              />
            </Field>

            <Field label="Difficulty">
              <Segmented<InterviewDifficulty>
                ariaLabel="Difficulty"
                value={difficulty}
                onChange={setDifficulty}
                options={INTERVIEW_DIFFICULTIES}
              />
            </Field>

            <Field label="Duration" hint={`Up to ${INTERVIEW_MAX_LEARNER_TURNS} questions — the interview wraps up early when you reach the limit.`}>
              <Segmented<number>
                ariaLabel="Duration"
                value={duration}
                onChange={setDuration}
                options={DURATIONS}
              />
            </Field>

            {error ? (
              <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button onClick={handleStart} disabled={starting} size="lg" className="w-full sm:w-auto">
              {starting ? "Preparing your interviewer…" : active ? "Start new interview" : "Start interview"}
            </Button>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="How it works" />
            <ul className="space-y-3 px-5 pb-5 pt-1 sm:px-6">
              {[
                { icon: "🎙", text: "Answer out loud or by typing — both count the same." },
                { icon: "📷", text: "Optional camera self-view — private, never uploaded." },
                { icon: "✦", text: "Questions adapt to your verified skills and gaps." },
                { icon: "📝", text: "Finish with a written evaluation you can act on." },
              ].map((row) => (
                <li key={row.text} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <span aria-hidden="true" className="mt-0.5 shrink-0">
                    {row.icon}
                  </span>
                  {row.text}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Recent interviews" />
            <div className="px-5 pb-5 pt-1 sm:px-6">
              {sessionsQuery.isPending ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No interviews yet — your first one is a few clicks away.
                </p>
              ) : (
                <ul className="space-y-2">
                  {sessions.map((s) => (
                    <SessionRow key={s.id} session={s} />
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function SessionRow({ session }: { session: InterviewSessionSummary }) {
  const body = (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-secondary">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{session.config.targetRole}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {new Date(session.started_at).toLocaleDateString()} · {session.config.durationMinutes} min
        </p>
      </div>
      <Badge tone={session.status === "completed" ? "success" : session.status === "in_progress" ? "primary" : "neutral"}>
        {STATUS_LABEL[session.status] ?? session.status}
      </Badge>
    </div>
  );
  if (session.status === "completed" && session.has_evaluation) {
    return (
      <li>
        <Link to="/interview/$sessionId/results" params={{ sessionId: session.id }} className="block">
          {body}
        </Link>
      </li>
    );
  }
  if (session.status === "in_progress") {
    return (
      <li>
        <Link to="/interview/$sessionId" params={{ sessionId: session.id }} className="block">
          {body}
        </Link>
      </li>
    );
  }
  return <li aria-disabled="true" className="opacity-70">{body}</li>;
}
