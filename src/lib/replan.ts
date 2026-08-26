/**
 * Re-planning engine — pure logic.
 *
 * No IO here: the server function feeds it rows and persists the result.
 * Nothing in this file changes BKT, the forgetting curve or hidden-gap
 * detection — it only consumes their outputs.
 */

export const HARD_PREREQ_WEIGHT = 0.8;
/** A node at or above this decayed mastery is effectively mastered. */
export const EFFECTIVELY_MASTERED = 0.8;

/**
 * Bridge effort rule — THE single formula for every bridge module,
 * everywhere it appears (replan budget maths, plan items, bridge screen).
 *
 * Each generated daily task is one focused study block of BRIDGE_TASK_HOURS
 * hours, so a bridge costs `taskCount × BRIDGE_TASK_HOURS`. The estimate is
 * derived from the bridge's own generated structure (its task list), applied
 * uniformly to every bridge — never an arbitrary per-bridge guess, never an
 * LLM-generated number, never hardcoded to 0.
 */
export const BRIDGE_TASK_HOURS = 1.5;

export function bridgeEffortHours(taskCount: number): number {
  return Number((Math.max(1, taskCount) * BRIDGE_TASK_HOURS).toFixed(1));
}

export type ReplanNode = {
  id: string;
  name: string;
  effort_hours: number;
  is_required: boolean;
  market_weight: number;
};

export type ReplanEdge = { from_node_id: string; to_node_id: string; weight: number };

export type ReplanBridge = {
  id: string;
  title: string;
  skill_node_id: string;
  status: string;
};

export type PlanItem = {
  kind: "skill" | "bridge";
  id: string;
  name: string;
  effort_hours: number;
  is_required: boolean;
};

export type PlanDiff = {
  added: string[];
  removed: string[];
  reordered: boolean;
};

/** Backward closure over hard prerequisites — same traversal as hidden-gap detection. */
export function hardPrerequisiteClosure(goalId: string, edges: ReplanEdge[]): Set<string> {
  const hard = edges.filter((e) => Number(e.weight) >= HARD_PREREQ_WEIGHT);
  const closure = new Set<string>([goalId]);
  const queue = [goalId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of hard) {
      if (edge.to_node_id !== current) continue;
      if (closure.has(edge.from_node_id)) continue;
      closure.add(edge.from_node_id);
      queue.push(edge.from_node_id);
    }
  }
  return closure;
}

/** Kahn topological sort restricted to `ids`; a node follows all its hard prerequisites. */
export function topoSortClosure(
  ids: Set<string>,
  nodes: ReplanNode[],
  edges: ReplanEdge[],
): ReplanNode[] {
  const byId = new Map(nodes.filter((n) => ids.has(n.id)).map((n) => [n.id, n]));
  const scoped = edges.filter(
    (e) =>
      Number(e.weight) >= HARD_PREREQ_WEIGHT &&
      byId.has(e.from_node_id) &&
      byId.has(e.to_node_id),
  );
  const indegree = new Map<string, number>([...byId.keys()].map((id) => [id, 0]));
  for (const e of scoped) indegree.set(e.to_node_id, (indegree.get(e.to_node_id) ?? 0) + 1);

  const ready = [...byId.values()]
    .filter((n) => (indegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => Number(a.effort_hours) - Number(b.effort_hours));
  const out: ReplanNode[] = [];
  while (ready.length) {
    const node = ready.shift()!;
    out.push(node);
    for (const e of scoped) {
      if (e.from_node_id !== node.id) continue;
      const next = (indegree.get(e.to_node_id) ?? 0) - 1;
      indegree.set(e.to_node_id, next);
      if (next === 0) {
        const candidate = byId.get(e.to_node_id);
        if (candidate) ready.push(candidate);
      }
    }
    ready.sort((a, b) => Number(a.effort_hours) - Number(b.effort_hours));
  }
  for (const node of byId.values()) if (!out.includes(node)) out.push(node);
  return out;
}

/** Whole days between two calendar dates; today counts as 1 remaining day. */
export function daysBetween(now: Date, deadline: string): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(`${deadline}T00:00:00`);
  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  // Today still counts as a day of study — never collapse to zero.
  return diff === 0 ? 1 : diff;
}

/** THE deterministic suggestion formula — used by every code path. */
export function suggestedDeadline(
  totalEffortHours: number,
  dailyMinutes: number,
  now: Date,
): { required_days: number; date: string } {
  const requiredDays = Math.max(1, Math.ceil(totalEffortHours / (dailyMinutes / 60)));
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + requiredDays);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
  return { required_days: requiredDays, date: iso };
}

export function diffPlans(previous: string[] | null, next: string[]): PlanDiff {
  if (!previous) return { added: [], removed: [], reordered: false };
  const prevSet = new Set(previous);
  const nextSet = new Set(next);
  const added = next.filter((n) => !prevSet.has(n));
  const removed = previous.filter((n) => !nextSet.has(n));
  const keptPrev = previous.filter((n) => nextSet.has(n));
  const keptNext = next.filter((n) => prevSet.has(n));
  const reordered = keptPrev.join("|") !== keptNext.join("|");
  return { added, removed, reordered };
}

export function describeDiff(diff: PlanDiff, isInitial: boolean): string {
  if (isInitial) return "First roadmap built from your goal, time and target date.";
  const parts: string[] = [];
  if (diff.added.length) parts.push(`added ${diff.added.join(", ")}`);
  if (diff.removed.length) parts.push(`removed ${diff.removed.join(", ")}`);
  if (diff.reordered) parts.push("reordered the remaining steps");
  return parts.length ? `Plan updated: ${parts.join("; ")}.` : "Plan re-checked — nothing changed.";
}
