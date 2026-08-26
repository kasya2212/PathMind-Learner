/**
 * Canonical plan-history snapshot contract.
 *
 * `plan_history.node_snapshot` is ONLY a roadmap snapshot when the row's
 * trigger is one of PLAN_SNAPSHOT_TRIGGERS. Other triggers (hidden-gap
 * detection, calibration, course credit) store their own payload shape and
 * must never be read as a roadmap.
 *
 * Canonical roadmap shape (all new writes):
 *   { "nodes": ["<skill-node uuid>", ...] }   — unique IDs, topo order
 *
 * Legacy rows written before this contract stored names in `nodes` and IDs in
 * a parallel `node_ids` array; the adapter below upgrades them on read.
 */

export const PLAN_SNAPSHOT_TRIGGERS = [
  "plan_generated",
  "initial_plan",
  "time_budget_change",
  "deadline_overdue",
] as const;

export function isPlanSnapshotTrigger(trigger: string | null | undefined): boolean {
  return typeof trigger === "string" && (PLAN_SNAPSHOT_TRIGGERS as readonly string[]).includes(trigger);
}

export function uniqueInOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Reads ordered skill-node IDs out of any snapshot shape.
 * Returns [] for non-roadmap payloads (e.g. hidden-gap rows).
 */
export function snapshotNodeIds(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== "object") return [];
  const s = snapshot as { nodes?: unknown; node_ids?: unknown };
  // Legacy rows have a parallel node_ids array — prefer it because the legacy
  // `nodes` array contained display names, not IDs.
  const raw = Array.isArray(s.node_ids) ? s.node_ids : Array.isArray(s.nodes) ? s.nodes : [];
  return uniqueInOrder(raw.filter((v): v is string => typeof v === "string"));
}

/** True when two ordered ID lists are element-wise identical. */
export function sameOrderedIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * STRICT validation for "the current plan" reads.
 *
 * A plan_history row is trusted as the current plan ONLY when its
 * node_snapshot is the canonical shape {"nodes": [uuid, ...]} — an array of
 * valid skill_node_id UUIDs. Legacy rows (display names in `nodes`, parallel
 * `node_ids`/`items` arrays), non-plan payloads (gap rows, calibration rows)
 * and anything malformed all fail validation and must be SKIPPED — callers
 * continue searching older rows. Legacy rows are never rewritten or deleted;
 * this read-side validation is what makes them safe to coexist with.
 *
 * Display-only paths (history list) may still use the legacy-tolerant
 * snapshotNodeIds above; anything that drives the plan itself uses this.
 */
export function isValidPlanSnapshot(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  const nodes = (snapshot as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return false;
  return nodes.every((v) => typeof v === "string" && UUID_RE.test(v));
}

/** Ordered IDs from a snapshot, or [] when it is not a valid canonical plan. */
export function validPlanNodeIds(snapshot: unknown): string[] {
  if (!isValidPlanSnapshot(snapshot)) return [];
  return uniqueInOrder((snapshot as { nodes: string[] }).nodes);
}

/**
 * The newest row (rows passed newest-first) whose snapshot passes strict
 * validation — THE shared read path for "the current plan": replan's diff
 * source, getLatestPlanSnapshot and the dashboard's Next Best Step.
 */
export function firstValidPlanRow<T extends { node_snapshot: unknown }>(rows: T[]): T | null {
  for (const row of rows) if (isValidPlanSnapshot(row.node_snapshot)) return row;
  return null;
}
