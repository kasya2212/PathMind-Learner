/**
 * Evidence signals: Spaced Review + Pace.
 *
 * Read-time computations over EXISTING data only. Nothing in this file
 * writes to the database, mutates mastery, fabricates BKT observations, or
 * feeds into replan() — these signals are advisory affordances layered on
 * top of the existing (protected) BKT/decay state.
 */

import { decayMastery } from "@/lib/bkt";

/* ---------------------------------------------------------------------- */
/* Spaced Review                                                           */
/* ---------------------------------------------------------------------- */

/** Lower bound of the "solid grasp" band — a skill must have reached this. */
export const REVIEW_SOLID_THRESHOLD = 0.7;
/** Below this (after forgetting-curve decay) a once-solid skill is due. */
export const REVIEW_FADED_THRESHOLD = 0.6;

export type ReviewState = {
  p_mastery: number;
  observation_count: number;
  last_practiced_at: string | null;
};

/**
 * Review-due rule — the single deterministic definition used everywhere
 * review-due status is computed. ALL three conditions must hold:
 *
 *  1. raw p_mastery >= 0.7 — the learner previously reached "solid grasp"
 *     through real BKT observations. NOTE: "reached >= 0.7 at some point"
 *     is not stored as a separate fact; the current stored raw value is the
 *     deterministic proxy, and raw mastery is only ever written by
 *     updateMastery()'s BKT update, never by decay or exposure.
 *  2. last_practiced_at IS NOT NULL — decay is only meaningful against a
 *     real practice timestamp; without one the node is not reviewable even
 *     if p_mastery happens to read >= 0.7.
 *  3. current decayed mastery (the unchanged decayMastery() formula — this
 *     function never modifies it) has dropped below 0.6.
 *
 * Callers that already computed the decayed value (e.g. useSkillDna) pass it
 * in so the number the UI shows is exactly the number the rule evaluated.
 */
export function isReviewDue(
  state: ReviewState,
  decayedMastery?: number,
  now?: Date,
): boolean {
  if (Number(state.p_mastery) < REVIEW_SOLID_THRESHOLD) return false;
  if (!state.last_practiced_at) return false;
  const current =
    decayedMastery ??
    decayMastery({
      p_mastery: Number(state.p_mastery),
      observation_count: Number(state.observation_count),
      last_practiced_at: state.last_practiced_at,
      ...(now ? { now } : {}),
    });
  return current < REVIEW_FADED_THRESHOLD;
}

/* ---------------------------------------------------------------------- */
/* Pace (advisory, display-only)                                           */
/* ---------------------------------------------------------------------- */

export type PaceVerdict = "faster" | "steady" | "slower" | "insufficient";

/**
 * Pace classification — deliberately conservative, documented rule.
 *
 * What the data can defensibly support: learner_responses.created_at says
 * WHEN answers were submitted, not how long the learner actively worked.
 * Wall-clock spans (first → most recent response) can hide multi-day
 * absences, so we NEVER compare elapsed calendar time against effort_hours.
 *
 * Instead we classify WITHIN-SESSION question cadence, relative to the
 * learner's OWN baseline — nothing absolute:
 *
 *  - A "session cluster" = a run of responses on one skill where every
 *    consecutive gap is <= 15 minutes (clearly one sitting, not days apart).
 *  - A skill is classifiable only when it has a cluster of >= 4 responses.
 *  - A personal baseline exists only with >= 8 clustered responses across
 *    all skills; the baseline is the median inter-response gap over every
 *    qualifying cluster.
 *  - median gap on the skill < 0.6x baseline  => "faster"
 *    median gap on the skill > 1.67x baseline => "slower"
 *    otherwise                                 => "steady"
 *
 * Anything short of that evidence yields "insufficient" — we never invent a
 * faster/slower classification from sparse or gappy timestamps.
 */
export const ACTIVE_SESSION_GAP_MS = 15 * 60_000;
export const MIN_CLUSTER_RESPONSES = 4;
export const MIN_BASELINE_RESPONSES = 8;

/** Short advisory line — display-only, never feeds planning logic. */
export function paceLine(verdict: PaceVerdict): string {
  switch (verdict) {
    case "faster":
      return "Pace: you're moving through questions on this faster than your usual.";
    case "steady":
      return "Pace: about your usual speed on this.";
    case "slower":
      return "Pace: slower than your usual — this one may be stretching you.";
    default:
      return "Not enough activity yet to estimate pace.";
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const center = sorted[mid] ?? 0;
  return sorted.length % 2 ? center : ((sorted[mid - 1] ?? center) + center) / 2;
}

/**
 * Per-skill pace verdicts from raw response timestamps. Nodes absent from
 * the returned map are "insufficient" by default (callers use ?? "insufficient").
 */
export function computePaceByNode(
  responses: { skill_node_id: string; created_at: string }[],
): Map<string, PaceVerdict> {
  const byNode = new Map<string, number[]>();
  for (const r of responses) {
    const t = new Date(r.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    const arr = byNode.get(r.skill_node_id) ?? [];
    arr.push(t);
    byNode.set(r.skill_node_id, arr);
  }

  let clusteredResponses = 0;
  const baselineGaps: number[] = [];
  const nodeGaps = new Map<string, number[]>();

  for (const [nodeId, times] of byNode) {
    times.sort((a, b) => a - b);
    const first = times[0];
    if (first === undefined) continue;
    let cluster: number[] = [first];
    const flush = () => {
      if (cluster.length >= MIN_CLUSTER_RESPONSES) {
        clusteredResponses += cluster.length;
        const gaps: number[] = [];
        for (let i = 1; i < cluster.length; i++) {
          const end = cluster[i];
          const start = cluster[i - 1];
          if (end !== undefined && start !== undefined) gaps.push(end - start);
        }
        baselineGaps.push(...gaps);
        nodeGaps.set(nodeId, (nodeGaps.get(nodeId) ?? []).concat(gaps));
      }
    };
    for (let i = 1; i < times.length; i++) {
      const current = times[i];
      const previous = times[i - 1];
      if (current === undefined || previous === undefined) continue;
      if (current - previous <= ACTIVE_SESSION_GAP_MS) {
        cluster.push(current);
      } else {
        flush();
        cluster = [current];
      }
    }
    flush();
  }

  const result = new Map<string, PaceVerdict>();
  if (clusteredResponses < MIN_BASELINE_RESPONSES || baselineGaps.length === 0) {
    return result;
  }
  const baseline = median(baselineGaps);
  if (baseline <= 0) return result;

  for (const [nodeId, gaps] of nodeGaps) {
    const ratio = median(gaps) / baseline;
    result.set(nodeId, ratio < 0.6 ? "faster" : ratio > 1.67 ? "slower" : "steady");
  }
  return result;
}
