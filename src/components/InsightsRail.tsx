import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarClock,
  History,
  Route as RouteIcon,
  Sparkles,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import { Badge, InfoTip, Skeleton } from "@/components/Primitives";
import { buildWhy, triggerLabel } from "@/lib/why";
import {
  TRAJECTORY_LABEL,
  computeFragility,
  computeInterventions,
  computeLearningTwin,
  type TrajectoryStatus,
} from "@/lib/intelligence";
import type { SkillEdge, SkillNode } from "@/lib/pathmind";
import type { PlanHistoryEntry } from "@/lib/usePlanHistory";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<
  TrajectoryStatus,
  "success" | "info" | "warning" | "danger" | "neutral"
> = {
  on_track: "success",
  tight: "info",
  at_risk: "warning",
  overdue: "danger",
  no_deadline: "neutral",
};

export type InsightsRailProps = {
  next: SkillNode | null;
  nodes: SkillNode[];
  edges: SkillEdge[];
  decayed: Map<string, number>;
  goalNode: SkillNode | null;
  hiddenGapIds: Set<string>;
  hiddenGaps: { id: string; name: string }[];
  reviewDue: { nodeId: string; name: string; decayed: number }[];
  dailyMinutes: number;
  deadline: string | null;
  daysLeft: number | null;
  history: PlanHistoryEntry[];
  historyLoading: boolean;
  loading: boolean;
};

type Alert = {
  key: string;
  icon: LucideIcon;
  tone: "warning" | "danger" | "info" | "neutral";
  text: React.ReactNode;
  href?: string;
  to?: string;
};

/**
 * AI insights rail — the app's reasoning surfaced compactly. Every item is
 * grounded in a signal the app already computes (why-points, decay, hidden
 * gaps, Learning Twin, plan history). There is deliberately no chat input:
 * nothing here invents a conversational backend.
 *
 * Rendered as a sticky right rail on desktop and inside a bottom sheet on
 * mobile — same component, different container.
 */
export function InsightsRail(props: InsightsRailProps) {
  const {
    next,
    nodes,
    edges,
    decayed,
    goalNode,
    hiddenGapIds,
    hiddenGaps,
    reviewDue,
    dailyMinutes,
    deadline,
    daysLeft,
    history,
    loading,
  } = props;

  const ctx = useMemo(
    () => ({ nodes, edges, decayed, dailyMinutes, deadline }),
    [nodes, edges, decayed, dailyMinutes, deadline],
  );
  const twin = useMemo(() => computeLearningTwin(ctx), [ctx]);
  const fragile = useMemo(() => computeFragility(ctx), [ctx]);
  const interventions = useMemo(() => computeInterventions(ctx), [ctx]);

  // Why-points for the recommended step — the same builder the Skill DNA
  // Why panel uses, trimmed to the two strongest points.
  const whyPoints = useMemo(() => {
    if (!next || !nodes.length) return [];
    return buildWhy({
      node: next,
      nodes,
      edges,
      decayed,
      goalNode,
      isHiddenGap: hiddenGapIds.has(next.id),
      history,
    }).slice(0, 2);
  }, [next, nodes, edges, decayed, goalNode, hiddenGapIds, history]);

  const alerts = useMemo(() => {
    const list: Alert[] = [];
    if (reviewDue.length) {
      list.push({
        key: "review",
        icon: TrendingDown,
        tone: "warning",
        text: (
          <>
            <span className="font-medium text-foreground">{reviewDue[0]!.name}</span>
            {reviewDue.length > 1 ? ` and ${reviewDue.length - 1} more` : ""}{" "}
            {reviewDue.length > 1 ? "are" : "is"} starting to fade — a quick refresh brings
            {reviewDue.length > 1 ? " them" : " it"} back.
          </>
        ),
        href: "#due-review",
      });
    }
    if (hiddenGaps.length) {
      list.push({
        key: "gaps",
        icon: AlertTriangle,
        tone: "warning",
        text: (
          <>
            <span className="font-medium text-foreground">
              {hiddenGaps.length} hidden{" "}
              {hiddenGaps.length === 1 ? "prerequisite" : "prerequisites"}
            </span>{" "}
            detected on the way to your goal.
          </>
        ),
        to: "/gaps",
      });
    }
    if (twin.status === "at_risk" || twin.status === "overdue") {
      list.push({
        key: "deadline",
        icon: CalendarClock,
        tone: twin.status === "overdue" ? "danger" : "warning",
        text:
          twin.status === "overdue" ? (
            <>Your target date has passed — the plan can re-pace itself around a new one.</>
          ) : (
            <>
              At {dailyMinutes} min/day you're projected to miss your target date.
              {interventions
                ? ` Smallest fix: ${interventionSummary(interventions)}.`
                : ""}
            </>
          ),
        href: "#constraints",
      });
    }
    const latestChange = history[0];
    if (latestChange) {
      list.push({
        key: "history",
        icon: History,
        tone: "neutral",
        text: (
          <>
            Last plan change:{" "}
            <span className="font-medium text-foreground">
              {triggerLabel(latestChange.trigger)}
            </span>{" "}
            · {relativeDay(latestChange.created_at)}
          </>
        ),
        to: "/skill-dna",
      });
    }
    return list;
  }, [reviewDue, hiddenGaps, twin.status, dailyMinutes, interventions, history]);

  const bottleneck = fragile[0] ?? null;

  return (
    <div className="grid content-start gap-5">
      {/* Plan health — compact band, not a card stack. */}
      <section aria-label="Plan health">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            Plan health
            <InfoTip
              label="plan health"
              text="A projection from your current pace, today's mastery and the shape of your skill graph. It updates as you learn."
            />
          </h2>
          {loading ? (
            <Skeleton className="h-5 w-20" />
          ) : (
            <Badge tone={STATUS_TONE[twin.status]}>{TRAJECTORY_LABEL[twin.status]}</Badge>
          )}
        </div>
        {loading ? (
          <Skeleton className="mt-3 h-4 w-3/4" />
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {twin.milestones.length ? (
              <>
                Projected finish{" "}
                <span className="font-medium text-foreground">
                  {new Date(twin.projectedDate).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>{" "}
                · {twin.remainingHours} h to go
                {daysLeft !== null && daysLeft >= 0 ? ` · ${daysLeft} days available` : ""}
              </>
            ) : (
              "Everything in scope is solid — nothing left to project."
            )}
          </p>
        )}
      </section>

      {/* Why the recommended step — the engine's own reasoning, trimmed. */}
      {next && whyPoints.length ? (
        <section aria-label="Why this step" className="border-t border-border pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
            Why {next.name}?
          </h2>
          <ul className="mt-2.5 space-y-2.5">
            {whyPoints.map((point) => (
              <li key={point.key} className="text-sm leading-relaxed text-muted-foreground">
                <span
                  className={cn(
                    "mb-0.5 block text-[11px] font-medium uppercase tracking-wide",
                    point.tone === "warning" ? "text-warning-foreground" : "text-muted-foreground",
                  )}
                >
                  {point.label}
                </span>
                {point.body}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Signals — real alerts only, each linked to where you act on it. */}
      {alerts.length ? (
        <section aria-label="Signals" className="border-t border-border pt-4">
          <h2 className="text-sm font-semibold text-foreground">Needs attention</h2>
          <ul className="mt-2.5 space-y-1.5">
            {alerts.map((alert) => {
              const Icon = alert.icon;
              const body = (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md",
                      alert.tone === "warning" && "bg-warning-soft text-warning-foreground",
                      alert.tone === "danger" && "bg-destructive-soft text-destructive",
                      alert.tone === "info" && "bg-info-soft text-info",
                      alert.tone === "neutral" && "bg-secondary text-muted-foreground",
                    )}
                  >
                    <Icon className="h-3 w-3" />
                  </span>
                  <span className="min-w-0 text-sm leading-snug text-muted-foreground">
                    {alert.text}
                  </span>
                </>
              );
              const cls =
                "flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-secondary/60";
              return (
                <li key={alert.key}>
                  {alert.to ? (
                    <Link to={alert.to} className={cls}>
                      {body}
                    </Link>
                  ) : (
                    <a href={alert.href} className={cls}>
                      {body}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Fragile path — the single worst bottleneck, if one exists. */}
      {bottleneck ? (
        <section aria-label="Fragile path" className="border-t border-border pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <RouteIcon aria-hidden="true" className="h-3.5 w-3.5 text-warning-foreground" />
            Fragile point
          </h2>
          <p className="mt-2 text-sm leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">{bottleneck.name}</span> stalls{" "}
            {bottleneck.dependentCount}{" "}
            {bottleneck.dependentCount === 1 ? "skill" : "skills"} (
            {bottleneck.remainingDownstreamHours} h downstream) if it slips.
          </p>
          <Link
            to="/skill-dna"
            className="mt-1.5 inline-block text-xs font-medium text-primary hover:underline"
          >
            See it on the map
          </Link>
        </section>
      ) : null}
    </div>
  );
}

function interventionSummary(
  interventions: NonNullable<ReturnType<typeof computeInterventions>>,
): string {
  const best = interventions.options.find((o) => o.kind === interventions.recommended);
  if (!best) return "adjust the plan";
  if (best.kind === "time") return `add ${best.extraMinPerDay} min a day`;
  if (best.kind === "deadline")
    return `move the target to ${new Date(`${best.newDate}T00:00:00`).toLocaleDateString(
      undefined,
      { month: "short", day: "numeric" },
    )}`;
  return `set aside ${best.droppedNames.join(", ")}`;
}

function relativeDay(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return "today";
  if (sameDay(d, new Date(now.getTime() - 86_400_000))) return "yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
