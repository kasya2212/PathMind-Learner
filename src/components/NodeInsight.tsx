import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  Clock3,
  Milestone,
  Route as RouteIcon,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  InfoTip,
  InlineLoading,
  MasteryReadout,
  Skeleton,
} from "@/components/Primitives";
import { HELP_TEXT, masteryLabel } from "@/lib/mastery";
import { MASTERED, type SkillEdge, type SkillNode } from "@/lib/pathmind";
import { paceLine, type PaceVerdict } from "@/lib/evidence";
import {
  BRIDGE_FALLBACK_MARKER,
  buildWhy,
  triggerLabel,
  triggerTone,
} from "@/lib/why";
import { uniqueInOrder } from "@/lib/planHistory";
import type { PlanHistoryEntry } from "@/lib/usePlanHistory";
import { cn } from "@/lib/utils";

export type NodeInsightData = {
  node: SkillNode;
  nodes: SkillNode[];
  edges: SkillEdge[];
  decayed: Map<string, number>;
  rawMastery: Map<string, number>;
  goalNode: SkillNode | null;
  isHiddenGap: boolean;
  observationCount: number;
  lastPracticedAt: string | null;
  /** Bridge-module view timestamp — exposure only, never BKT evidence. */
  lastExposedAt: string | null;
  /** Advisory pace signal — display-only text. */
  pace: PaceVerdict;
  history: PlanHistoryEntry[];
  historyLoading: boolean;
};

type TabKey = "why" | "details";

// Plan-change history is intentionally NOT a tab here: it lives in its own
// "How your plan has changed" card on the Skill DNA page, so it renders
// exactly once per page.
const TABS: { key: TabKey; label: string }[] = [
  { key: "why", label: "Why" },
  { key: "details", label: "Details" },
];

/**
 * The node explanation surface. Same component in the desktop side panel and
 * the mobile bottom sheet — only the container differs.
 */
export function NodeInsight({ data }: { data: NodeInsightData }) {
  const [tab, setTab] = useState<TabKey>("why");

  return (
    <div className="grid gap-4">
      <div
        role="tablist"
        aria-label="Skill explanation"
        className="flex gap-1 rounded-xl border border-border bg-surface-sunken p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "min-h-11 flex-1 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              tab === t.key
                ? "bg-card text-foreground shadow-[var(--shadow-card)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "why" ? <WhyTab data={data} /> : null}
      {tab === "details" ? <DetailsTab data={data} /> : null}
    </div>
  );
}

function WhyTab({ data }: { data: NodeInsightData }) {
  const points = buildWhy({
    node: data.node,
    nodes: data.nodes,
    edges: data.edges,
    decayed: data.decayed,
    goalNode: data.goalNode,
    isHiddenGap: data.isHiddenGap,
    history: data.history,
  });

  return (
    <div className="grid gap-4">
      {data.node.description ? (
        <p className="text-sm text-muted-foreground">{data.node.description}</p>
      ) : null}
      {points.map((point) => (
        <div
          key={point.key}
          className={cn(
            "rounded-xl border p-4",
            point.tone === "warning" && "border-warning/40 bg-warning-soft",
            point.tone === "primary" && "border-primary/40 bg-primary-soft",
            point.tone === "neutral" && "border-border bg-surface-sunken",
          )}
        >
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {point.label}
            {point.key === "mastery" ? (
              <InfoTip label="mastery" text={HELP_TEXT.mastery} />
            ) : null}
            {point.key === "prereq" ? (
              <InfoTip label="prerequisite" text={HELP_TEXT.prerequisite} />
            ) : null}
            {point.key === "gap" ? (
              <InfoTip label="hidden gap" text={HELP_TEXT.hiddenGap} />
            ) : null}
          </p>
          <p
            className={cn(
              "mt-2 text-sm leading-relaxed",
              point.tone === "warning" ? "text-warning-foreground" : "text-foreground",
            )}
          >
            {point.body}
          </p>
        </div>
      ))}

      {/* Exposure is only proof the bridge screen was opened — shown only
          while the skill has no real BKT observations to verify mastery. */}
      {data.lastExposedAt && data.observationCount === 0 ? (
        <div className="rounded-xl border border-border bg-surface-sunken p-4">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Exposure
          </p>
          <p className="mt-2 text-sm leading-relaxed text-foreground">
            Exposure recorded — mastery still needs verification.
          </p>
        </div>
      ) : null}

      {/* Advisory pace line — display-only, never affects planning. */}
      <p className="text-xs text-muted-foreground">{paceLine(data.pace)}</p>

      {data.isHiddenGap ? (
        <Link to="/bridge/$nodeId" params={{ nodeId: data.node.id }}>
          <Button size="sm" className="min-h-11 w-full sm:w-auto">
            Build a bridge module
          </Button>
        </Link>
      ) : null}
    </div>
  );
}

function DetailsTab({ data }: { data: NodeInsightData }) {
  const prereqs = data.edges
    .filter((e) => e.to_node_id === data.node.id)
    .map((e) => data.nodes.find((n) => n.id === e.from_node_id))
    .filter((n): n is SkillNode => Boolean(n));

  return (
    <div className="grid gap-4">
      <MasteryReadout value={data.decayed.get(data.node.id)} />
      <div className="grid grid-cols-2 gap-3">
        <Metric
          label="Best you've shown"
          value={`${Math.round((data.rawMastery.get(data.node.id) ?? 0) * 100)}%`}
        />
        <Metric
          label="Where you'd be today"
          value={`${Math.round((data.decayed.get(data.node.id) ?? 0) * 100)}%`}
        />
        <Metric label="Observed" value={`${data.observationCount}×`} />
        <Metric
          label="Last practised"
          value={data.lastPracticedAt ? relativeDays(data.lastPracticedAt) : "Never"}
        />
      </div>
      <div>
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Build these first
          <InfoTip label="prerequisite" text={HELP_TEXT.prerequisite} />
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {prereqs.length ? (
            prereqs.map((n) => (
              <Badge
                key={n.id}
                tone={(data.decayed.get(n.id) ?? 0) >= MASTERED ? "success" : "neutral"}
              >
                {n.name} · {masteryLabel(data.decayed.get(n.id))}
              </Badge>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">None — this is an entry point.</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Plan changes — compact grouped timeline.                                */
/*                                                                         */
/* PRESENTATION ONLY: nothing here writes, rewrites or deletes            */
/* plan_history. Rows from the same logical event (same trigger, written  */
/* within minutes of each other — e.g. one hidden-gap detection batch)    */
/* are merged into a single timeline entry on read. Detailed reasoning    */
/* stays behind an expand control so the list remains scannable.          */
/* ---------------------------------------------------------------------- */

type ChangeGroup = {
  key: string;
  trigger: string | null;
  created_at: string;
  rows: PlanHistoryEntry[];
};

/** Rows from the same logical change batch land within minutes of each other. */
const GROUP_WINDOW_MS = 10 * 60_000;

const TRIGGER_ICONS: Record<string, LucideIcon> = {
  hidden_gap_detected: AlertTriangle,
  initial_plan: Sparkles,
  plan_generated: RouteIcon,
  time_budget_change: Clock3,
  deadline_overdue: CalendarClock,
};

/** Hidden-gap rows carry the skill names in their summary text. */
function gapNamesFromSummary(summary: string | null): string[] {
  if (!summary) return [];
  const marker = "detected:";
  const i = summary.toLowerCase().indexOf(marker);
  if (i < 0) return [];
  return summary
    .slice(i + marker.length)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isClearedRow(row: PlanHistoryEntry): boolean {
  return Boolean(row.summary?.startsWith("All hidden prerequisites cleared"));
}

/** All skill names a group refers to, whichever way its rows carry them. */
function groupSkillNames(group: ChangeGroup): string[] {
  return uniqueInOrder(
    group.rows.flatMap((r) =>
      r.node_names.length ? r.node_names : gapNamesFromSummary(r.summary),
    ),
  );
}

/**
 * Repeated detections of the SAME skill set (e.g. gap detection re-running
 * before anything was learned) are one logical event — merge them into the
 * newest group instead of listing near-identical entries.
 */
function dedupeIdenticalGroups(groups: ChangeGroup[]): ChangeGroup[] {
  const kept: ChangeGroup[] = [];
  for (const group of groups) {
    const names = groupSkillNames(group);
    const dupe =
      names.length > 0
        ? kept.find((k) => {
            if (k.trigger !== group.trigger) return false;
            const other = groupSkillNames(k);
            return (
              other.length === names.length && other.every((n) => names.includes(n))
            );
          })
        : undefined;
    if (dupe) {
      dupe.rows.push(...group.rows);
    } else {
      kept.push(group);
    }
  }
  return kept;
}

/** Rows arrive newest-first; group by day, then merge same-trigger batches. */
function groupChanges(rows: PlanHistoryEntry[]): { label: string; groups: ChangeGroup[] }[] {
  const days: { label: string; groups: ChangeGroup[] }[] = [];
  for (const row of rows) {
    const label = dayLabel(row.created_at);
    let day = days[days.length - 1];
    if (!day || day.label !== label) {
      day = { label, groups: [] };
      days.push(day);
    }
    const last = day.groups[day.groups.length - 1];
    if (
      last &&
      last.trigger === row.trigger &&
      !isClearedRow(row) &&
      !last.rows.some(isClearedRow) &&
      Math.abs(new Date(last.created_at).getTime() - new Date(row.created_at).getTime()) <=
        GROUP_WINDOW_MS
    ) {
      last.rows.push(row);
    } else {
      day.groups.push({
        key: row.id,
        trigger: row.trigger,
        created_at: row.created_at,
        rows: [row],
      });
    }
  }
  for (const day of days) {
    day.groups = dedupeIdenticalGroups(day.groups);
  }
  return days;
}

/** Only the most recent grouped events show initially; the rest expand. */
const INITIAL_GROUPS = 4;

/** Newest-first plan changes as a compact, day-grouped activity timeline. */
export function PlanHistoryList({
  rows,
  loading,
}: {
  rows: PlanHistoryEntry[];
  loading: boolean;
}) {
  const [showAll, setShowAll] = useState(false);

  if (loading) {
    return (
      <div>
        <InlineLoading label="Loading your plan history…" />
        <Skeleton className="mt-3 h-12 w-full" />
        <Skeleton className="mt-2 h-12 w-full" />
      </div>
    );
  }
  if (!rows.length) {
    return (
      <EmptyState
        title="Nothing here yet"
        description="Every time your plan changes we'll log what moved and why, newest first."
      />
    );
  }

  const days = groupChanges(rows);
  const totalGroups = days.reduce((n, d) => n + d.groups.length, 0);

  let visibleDays = days;
  if (!showAll && totalGroups > INITIAL_GROUPS) {
    visibleDays = [];
    let count = 0;
    for (const day of days) {
      const remaining = INITIAL_GROUPS - count;
      if (remaining <= 0) break;
      visibleDays.push({ label: day.label, groups: day.groups.slice(0, remaining) });
      count += Math.min(remaining, day.groups.length);
    }
  }

  return (
    <div className="grid gap-5">
      {visibleDays.map((day) => (
        <section key={day.label} aria-label={`Changes from ${day.label}`}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {day.label}
          </p>
          <ol className="mt-1 divide-y divide-border">
            {day.groups.map((group) => (
              <ChangeGroupRow key={group.key} group={group} />
            ))}
          </ol>
        </section>
      ))}
      {totalGroups > INITIAL_GROUPS ? (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          aria-expanded={showAll}
          className="inline-flex min-h-9 items-center gap-1 justify-self-start text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {showAll
            ? "Show fewer"
            : `Show ${totalGroups - INITIAL_GROUPS} older ${
                totalGroups - INITIAL_GROUPS === 1 ? "change" : "changes"
              }`}
          <ChevronDown
            aria-hidden="true"
            className={cn("h-3.5 w-3.5 transition-transform", showAll && "rotate-180")}
          />
        </button>
      ) : null}
    </div>
  );
}

function ChangeGroupRow({ group }: { group: ChangeGroup }) {
  const [open, setOpen] = useState(false);
  const tone = triggerTone(group.trigger);
  const Icon = TRIGGER_ICONS[group.trigger ?? ""] ?? Milestone;

  const isGap = group.trigger === "hidden_gap_detected";
  const cleared = isGap && group.rows.every(isClearedRow);

  // Affected skills: roadmap rows carry resolved node_names; hidden-gap rows
  // carry the names in their summary text (read-side parse, data untouched).
  const skillNames = uniqueInOrder(
    group.rows.flatMap((r) =>
      r.node_names.length ? r.node_names : gapNamesFromSummary(r.summary),
    ),
  );

  const title = isGap
    ? cleared
      ? "Hidden prerequisites cleared"
      : "Missing foundations discovered"
    : triggerLabel(group.trigger);

  const first = group.rows[0];
  const line =
    isGap && !cleared
      ? `${skillNames.length || group.rows.length} missing foundation${
          (skillNames.length || group.rows.length) === 1 ? "" : "s"
        } detected on the way to your goal`
      : (first?.summary ?? "Your plan was updated.");

  const reasonings = uniqueInOrder(
    group.rows.map((r) => r.reasoning).filter((r): r is string => Boolean(r)),
  );
  const bridgeNote = group.rows.some((r) => r.reasoning?.includes(BRIDGE_FALLBACK_MARKER));
  const visibleNames = open ? skillNames : skillNames.slice(0, 3);
  const hiddenCount = skillNames.length - visibleNames.length;

  return (
    <li className="px-1 py-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg",
            tone === "warning" && "bg-warning-soft text-warning-foreground",
            tone === "primary" && "bg-primary-soft text-primary",
            tone === "neutral" && "bg-secondary text-muted-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 text-sm font-medium text-foreground">{title}</p>
            <time
              dateTime={group.created_at}
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
            >
              {timeStamp(group.created_at)}
            </time>
          </div>
          <p className={cn("mt-0.5 text-sm text-muted-foreground", !open && "line-clamp-2")}>
            {line}
          </p>
          {visibleNames.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {visibleNames.map((name) => (
                <span
                  key={name}
                  className="max-w-full truncate rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
                >
                  {name}
                </span>
              ))}
              {hiddenCount > 0 ? (
                <span className="text-[11px] text-muted-foreground">+{hiddenCount} more</span>
              ) : null}
            </div>
          ) : null}
          {reasonings.length ? (
            <>
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="-my-1 mt-2 inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {open ? "Hide details" : "Why this changed"}
                <ChevronDown
                  aria-hidden="true"
                  className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
                />
              </button>
              {open ? (
                <div className="mb-1 mt-1.5 grid gap-2 border-l-2 border-border pl-3">
                  {reasonings.map((r, i) => (
                    <p key={i} className="text-sm leading-relaxed text-muted-foreground">
                      {r}
                    </p>
                  ))}
                </div>
              ) : null}
              {bridgeNote && !open ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Bridge-module completion isn't tracked yet, so every generated bridge is included
                  by default.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Mobile presentation: a dismissible bottom sheet, never a blocking modal. */
export function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        className="absolute inset-0 bg-overlay"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-label={title}
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-card px-4 pb-8 pt-4 shadow-[var(--shadow-pop)]"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" aria-hidden="true" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <Button variant="ghost" size="sm" className="min-h-11" onClick={onClose}>
            Close
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-sunken px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function relativeDays(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

/** Clock time for a timeline row — the day is already a section header. */
function timeStamp(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Today" / "Yesterday" / "Fri, Aug 21" day-section labels. */
function dayLabel(iso: string) {
  const d = new Date(iso);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const now = new Date();
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
