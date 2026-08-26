/**
 * PathMind intelligence layer — pure, read-only projection logic.
 *
 * Three features share these primitives:
 *  - Learning Twin:           projected completion timeline
 *  - Fragile Path Detector:   bottleneck skills by downstream dependency impact
 *  - Minimum Intervention:    smallest viable recovery when the plan doesn't fit
 *
 * No IO, no writes. Everything consumes the same graph + decayed mastery the
 * rest of the app already computed.
 */

import { decayMastery } from "@/lib/bkt";
import { HARD_PREREQ_WEIGHT, daysBetween, suggestedDeadline } from "@/lib/replan";
import { MASTERED, type SkillEdge, type SkillNode } from "@/lib/pathmind";
import { topoOrder } from "@/lib/graph";

export type DnaRow = {
  skill_node_id: string;
  p_mastery: number;
  observation_count: number;
  last_practiced_at: string | null;
};

export type TrajectoryStatus = "on_track" | "tight" | "at_risk" | "overdue" | "no_deadline";

export type Milestone = {
  nodeId: string;
  name: string;
  /** ISO date the learner is projected to finish this skill. */
  date: string;
  cumulativeHours: number;
};

export type LearningTwin = {
  remainingHours: number;
  projectedDays: number;
  projectedDate: string;
  status: TrajectoryStatus;
  milestones: Milestone[];
};

export type Bottleneck = {
  nodeId: string;
  name: string;
  decayed: number;
  /** Skills in scope that (transitively) hard-depend on this one. */
  dependentNames: string[];
  dependentCount: number;
  remainingDownstreamHours: number;
  /** 0–1 normalized within the returned set. */
  fragility: number;
};

export type InterventionOption =
  | { kind: "time"; extraMinPerDay: number }
  | { kind: "deadline"; newDate: string; extraDays: number }
  | { kind: "scope"; droppedNames: string[]; savedHours: number };

export type Interventions = {
  shortfallHours: number;
  daysLeft: number;
  options: InterventionOption[];
  recommended: InterventionOption["kind"];
};

type Ctx = {
  nodes: SkillNode[];
  edges: SkillEdge[];
  decayed: Map<string, number>;
  dailyMinutes: number;
  deadline: string | null;
  today?: Date;
};

function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Remaining skills in topo order (decayed mastery below the mastered bar). */
export function remainingNodes(ctx: Ctx): SkillNode[] {
  const scoped = ctx.nodes.filter((n) => (ctx.decayed.get(n.id) ?? 0) < MASTERED);
  return topoOrder(scoped, ctx.edges);
}

/** Learning Twin — when will this learner finish, at their current pace? */
export function computeLearningTwin(ctx: Ctx): LearningTwin {
  const today = ctx.today ?? new Date();
  const dailyHours = Math.max(0.25, ctx.dailyMinutes / 60);
  const remaining = remainingNodes(ctx);

  let cumulative = 0;
  const milestones: Milestone[] = [];
  for (const node of remaining) {
    const decayedLevel = ctx.decayed.get(node.id) ?? 0;
    // The less of the skill is demonstrated, the more of its effort remains.
    const remainingEffort = Number(node.effort_hours) * Math.max(0.15, MASTERED - decayedLevel);
    cumulative += remainingEffort;
    milestones.push({
      nodeId: node.id,
      name: node.name,
      cumulativeHours: cumulative,
      date: addDays(today, Math.ceil(cumulative / dailyHours)),
    });
  }

  const projectedDays = Math.ceil(cumulative / dailyHours);
  const projectedDate = cumulative > 0 ? addDays(today, projectedDays) : addDays(today, 0);

  let status: TrajectoryStatus = "no_deadline";
  if (ctx.deadline) {
    const daysLeft = daysBetween(today, ctx.deadline);
    if (daysLeft < 0) status = "overdue";
    else if (projectedDays <= Math.max(1, daysLeft * 0.85)) status = "on_track";
    else if (projectedDays <= daysLeft) status = "tight";
    else status = "at_risk";
  }

  return {
    remainingHours: Math.round(cumulative * 10) / 10,
    projectedDays,
    projectedDate,
    status,
    // Compact timeline: first two, a midpoint, and the finish line.
    milestones:
      milestones.length <= 4
        ? milestones
        : [
            milestones[0],
            milestones[1],
            milestones[Math.floor(milestones.length / 2)],
            milestones[milestones.length - 1],
          ].filter((m): m is Milestone => Boolean(m)),
  };
}

/** Fragile Path Detector — skills whose slip-up would stall the most future work. */
export function computeFragility(ctx: Ctx): Bottleneck[] {
  const today = ctx.today ?? new Date();
  const hardOut = new Map<string, string[]>();
  const inScope = new Set(ctx.nodes.map((n) => n.id));
  for (const e of ctx.edges) {
    if (Number(e.weight) < HARD_PREREQ_WEIGHT) continue;
    if (!inScope.has(e.from_node_id) || !inScope.has(e.to_node_id)) continue;
    hardOut.set(e.from_node_id, [...(hardOut.get(e.from_node_id) ?? []), e.to_node_id]);
  }

  const totalEffort = ctx.nodes.reduce((sum, n) => sum + Number(n.effort_hours), 0) || 1;

  // Deadline pressure: how over-subscribed the available time already is.
  let pressure = 1;
  if (ctx.deadline) {
    const daysLeft = Math.max(0, daysBetween(today, ctx.deadline));
    const available = daysLeft * (ctx.dailyMinutes / 60);
    if (available > 0) pressure = Math.min(2, Math.max(1, totalEffort / available));
  }

  const byId = new Map(ctx.nodes.map((n) => [n.id, n]));
  const raw: (Omit<Bottleneck, "fragility"> & { score: number })[] = [];

  for (const node of ctx.nodes) {
    const decayedLevel = ctx.decayed.get(node.id) ?? 0;
    if (decayedLevel >= MASTERED) continue;

    // Forward closure over hard edges within scope.
    const seen = new Set<string>();
    const queue = [...(hardOut.get(node.id) ?? [])];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const next of hardOut.get(id) ?? []) if (!seen.has(next)) queue.push(next);
    }
    if (seen.size === 0) continue;

    let downstreamHours = 0;
    const names: string[] = [];
    for (const id of seen) {
      const dep = byId.get(id);
      if (!dep) continue;
      names.push(dep.name);
      if ((ctx.decayed.get(id) ?? 0) < MASTERED) downstreamHours += Number(dep.effort_hours);
    }

    const score =
      (1 - decayedLevel) * seen.size * (1 + downstreamHours / totalEffort) * pressure;
    raw.push({
      nodeId: node.id,
      name: node.name,
      decayed: decayedLevel,
      dependentNames: names.slice(0, 4),
      dependentCount: seen.size,
      remainingDownstreamHours: Math.round(downstreamHours * 10) / 10,
      score,
    });
  }

  raw.sort((a, b) => b.score - a.score);
  const top = raw.slice(0, 3);
  const max = top[0]?.score || 1;
  return top.map(({ score, ...rest }) => ({
    ...rest,
    fragility: Math.round((score / max) * 100) / 100,
  }));
}

/**
 * Minimum Intervention Engine — the smallest viable fix when the roadmap
 * doesn't fit the deadline. Returns null when the plan already fits.
 */
export function computeInterventions(ctx: Ctx): Interventions | null {
  if (!ctx.deadline) return null;
  const today = ctx.today ?? new Date();
  const remaining = remainingNodes(ctx);
  const totalEffort = remaining.reduce((sum, n) => sum + Number(n.effort_hours), 0);
  const daysLeft = daysBetween(today, ctx.deadline);
  const availableHours = Math.max(0, daysLeft) * (ctx.dailyMinutes / 60);
  const shortfall = Math.round((totalEffort - availableHours) * 10) / 10;

  if (shortfall <= 0) return null;

  const options: InterventionOption[] = [];

  if (daysLeft > 0) {
    // Round up to a 5-minute step so the suggestion is human.
    const extra = Math.ceil(shortfall / daysLeft / (5 / 60)) * 5;
    options.push({ kind: "time", extraMinPerDay: extra });
  }

  // Deadline move: reuse the deterministic formula so the suggestion matches
  // what the planner would compute from scratch.
  const suggestion = suggestedDeadline(totalEffort, ctx.dailyMinutes, today);
  const extraDays = daysLeft < 0 ? suggestion.required_days : suggestion.required_days - daysLeft;
  if (extraDays > 0) options.push({ kind: "deadline", newDate: suggestion.date, extraDays });

  // Scope cut: cheapest optional skills first (never required ones).
  const optional = remaining
    .filter((n) => !n.is_required)
    .sort((a, b) => Number(a.market_weight) - Number(b.market_weight));
  let saved = 0;
  const drops: string[] = [];
  for (const node of optional) {
    if (saved >= shortfall) break;
    drops.push(node.name);
    saved += Number(node.effort_hours);
  }
  if (drops.length) options.push({ kind: "scope", droppedNames: drops, savedHours: Math.round(saved * 10) / 10 });

  const recommended: InterventionOption["kind"] =
    options.find((o) => o.kind === "time" && o.extraMinPerDay <= 30)?.kind ??
    options.find((o) => o.kind === "deadline")?.kind ??
    options[options.length - 1]?.kind ??
    "deadline";

  return { shortfallHours: shortfall, daysLeft, options, recommended };
}

/** Decayed mastery map from stored skill DNA (display/planning only). */
export function decayedFromDna(rows: DnaRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(
      row.skill_node_id,
      decayMastery({
        p_mastery: Number(row.p_mastery),
        observation_count: row.observation_count,
        last_practiced_at: row.last_practiced_at,
      }),
    );
  }
  return map;
}

export const TRAJECTORY_LABEL: Record<TrajectoryStatus, string> = {
  on_track: "On track",
  tight: "Tight but doable",
  at_risk: "At risk",
  overdue: "Past deadline",
  no_deadline: "No deadline set",
};
