import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  InfoTip,
  Skeleton,
} from "@/components/Primitives";
import { useAuth } from "@/lib/auth";
import { HELP_TEXT, masteryLabel } from "@/lib/mastery";
import { updateMastery } from "@/lib/skilldna.functions";
import { useSkillDna } from "@/lib/useSkillDna";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/plan")({
  head: () => ({
    meta: [
      { title: "Learning plan — PathMind" },
      {
        name: "description",
        content:
          "A day-by-day plan generated from your goal, target date, study time, prerequisites and current mastery.",
      },
      { property: "og:title", content: "Learning plan — PathMind" },
      {
        property: "og:description",
        content: "Prerequisite-ordered, deadline-aware and built from your real mastery.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlanPage,
});

const DATE_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function label(date: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return DATE_FMT.format(date);
}

function PlanPage() {
  const dna = useSkillDna();
  const totalMinutes = dna.plan.reduce((sum, e) => sum + e.minutes, 0);

  return (
    <AppShell
      title="Your learning plan"
      subtitle={
        dna.goalNode
          ? `${dna.plan.length} sessions · ${Math.round(totalMinutes / 60)} h to reach ${dna.goalNode.name}${
              dna.daysLeft === null
                ? ""
                : dna.daysLeft >= 0
                  ? ` · ${dna.daysLeft} days to target`
                  : " · target date has passed"
            }`
          : "Set a goal in your profile to generate a plan."
      }
      actions={
        <Link to="/dashboard">
          <Button variant="secondary">Back to dashboard</Button>
        </Link>
      }
    >
      {dna.error ? <ErrorState /> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader
            title="Schedule"
            subtitle="Ordered by prerequisites, paced to your daily study time and target date."
          />
          <div className="px-4 pb-6 pt-4 sm:px-6">
            {dna.loading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : dna.plan.length === 0 ? (
              <EmptyState
                title="Nothing scheduled"
                description="Either every skill in your graph is already solid, or you haven't set a goal yet."
                action={
                  <Link to="/diagnostic">
                    <Button size="sm">Run a calibration</Button>
                  </Link>
                }
              />
            ) : (
              <ScheduleTimeline />
            )}
          </div>
        </Card>

        <div className="grid h-fit content-start gap-5">
          <Card className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Plan inputs
            </p>
            <dl className="mt-3 space-y-2 text-sm text-muted-foreground">
              <div className="flex items-baseline justify-between gap-3">
                <dt>Goal</dt>
                <dd className="truncate text-foreground">{dna.goalNode?.name ?? "not set"}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt>Target date</dt>
                <dd className="text-foreground">{dna.profile?.deadline_date ?? "not set"}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt>Daily time</dt>
                <dd className="text-foreground">{dna.profile?.daily_time_minutes ?? 45} min</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt>Skills in scope</dt>
                <dd className="text-foreground">{dna.nodes.length}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt>Hidden gaps prioritised</dt>
                <dd className="text-foreground">{dna.hiddenGaps.length}</dd>
              </div>
            </dl>
          </Card>
          <Card className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pacing
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {dna.daysLeft === null
                ? "Add a target date on the dashboard and PathMind will compress or relax the schedule to fit."
                : dna.daysLeft < 0
                  ? "Your target date has passed — pick a new one on the dashboard and the plan re-paces itself."
                  : dna.daysLeft >= dna.plan.length
                    ? `Comfortable: ${dna.plan.length} sessions across ${dna.daysLeft} days.`
                    : `Tight: ${dna.plan.length} sessions but only ${dna.daysLeft} days — sessions are compressed.`}
            </p>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

/**
 * Connected vertical timeline: date rail + compact row per session. Extended
 * detail ("why now", prerequisites) stays behind an expand control. Mark
 * complete reuses the exact same updateMastery() flow as the dashboard.
 * Mutation state is keyed by the unique ROW key (node.id + index), not the
 * node id alone — the same skill can appear in several sessions, and the
 * pending/feedback state must land only on the row that was clicked.
 */
function ScheduleTimeline() {
  const dna = useSkillDna();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const runUpdateMastery = useServerFn(updateMastery);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<
    { key: string; previous: number; next: number } | null
  >(null);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const fadeTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    },
    [],
  );

  const markComplete = useMutation({
    mutationFn: async (vars: { nodeId: string; key: string }) =>
      runUpdateMastery({ data: { skill_node_id: vars.nodeId, correct: true } }),
    onSuccess: async (res, vars) => {
      setFeedback({ key: vars.key, previous: res.previous_mastery, next: res.new_mastery });
      setFeedbackVisible(true);
      if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
      fadeTimer.current = window.setTimeout(() => setFeedbackVisible(false), 2000);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["learner-state", user?.id] }),
        queryClient.invalidateQueries({ queryKey: ["hidden-gaps", user?.id] }),
        queryClient.invalidateQueries({ queryKey: ["plan-snapshot", user?.id] }),
      ]);
    },
  });

  return (
    <ol>
      {dna.plan.map((entry, index) => {
        const key = `${entry.node.id}-${index}`;
        const open = expandedKey === key;
        const last = index === dna.plan.length - 1;
        const rowFeedback =
          feedback?.key === key && feedbackVisible ? feedback : null;
        return (
          <li key={key} className="grid grid-cols-[18px_minmax(0,1fr)] gap-3.5">
            {/* timeline spine */}
            <div className="relative flex justify-center" aria-hidden="true">
              {!last ? <span className="absolute bottom-0 top-5 w-px bg-border" /> : null}
              <span
                className={cn(
                  "relative z-10 mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full border-2 bg-card",
                  index === 0 ? "border-primary" : "border-border-strong",
                )}
              />
            </div>

            <div className={cn("min-w-0", !last && "pb-5")}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {label(entry.date)} · {entry.minutes} min
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <p className="text-sm font-semibold text-foreground">{entry.node.name}</p>
                <span className="text-xs text-muted-foreground">
                  {masteryLabel(entry.mastery)}
                </span>
                {entry.isHiddenGap ? <Badge tone="warning">Hidden gap</Badge> : null}
                <Badge tone={entry.prerequisitesReady ? "success" : "info"}>
                  {entry.prerequisitesReady ? "Prereqs ready" : "Prereqs in progress"}
                </Badge>
                <span className="ms-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setExpandedKey(open ? null : key)}
                    aria-expanded={open}
                    className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    Why now?
                    <ChevronDown
                      aria-hidden="true"
                      className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
                    />
                  </button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="min-h-9"
                    disabled={markComplete.isPending}
                    onClick={() => markComplete.mutate({ nodeId: entry.node.id, key })}
                  >
                    {markComplete.isPending && markComplete.variables?.key === key
                      ? "Updating…"
                      : "Mark complete"}
                  </Button>
                </span>
              </div>

              <div aria-live="polite">
                {rowFeedback ? (
                  <p className="animate-pop mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      Logged — mastery {rowFeedback.previous.toFixed(2)} →{" "}
                      {rowFeedback.next.toFixed(2)}
                    </span>
                    <InfoTip label="mastery" text={HELP_TEXT.mastery} />
                  </p>
                ) : null}
                {markComplete.isError && markComplete.variables?.key === key ? (
                  <p className="mt-2 text-xs text-destructive" role="alert">
                    We couldn't log that just now — try again.
                  </p>
                ) : null}
              </div>

              {open ? (
                <div className="animate-enter mt-2.5 rounded-xl border border-border bg-surface-sunken px-4 py-3">
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Why now? </span>
                    {entry.reason}
                  </p>
                  {entry.prerequisites.length ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      After: {entry.prerequisites.join(", ")}
                    </p>
                  ) : null}
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Difficulty: {entry.difficulty}
                  </p>
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
