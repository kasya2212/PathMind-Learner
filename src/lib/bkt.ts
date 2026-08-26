/**
 * Bayesian Knowledge Tracing + forgetting curve.
 *
 * Pure math, shared by the server functions (source of truth for writes) and
 * the client (display-only decay). No IO here.
 */

export const P_TRANSIT = 0.15;
export const P_SLIP = 0.1;
export const P_GUESS = 0.2;

export const DEFAULT_MASTERY = 0.1;

export type BktResult = {
  previous_mastery: number;
  posterior_mastery: number;
  new_mastery: number;
};

/** Exact BKT posterior + learning transit for one observation. */
export function bktUpdate(p: number, correct: boolean): BktResult {
  const posterior = correct
    ? (p * (1 - P_SLIP)) / (p * (1 - P_SLIP) + (1 - p) * P_GUESS)
    : (p * P_SLIP) / (p * P_SLIP + (1 - p) * (1 - P_GUESS));

  const next = posterior + (1 - posterior) * P_TRANSIT;

  return { previous_mastery: p, posterior_mastery: posterior, new_mastery: next };
}

/**
 * Forgetting curve. DISPLAY + PLANNING ONLY — never written back to
 * `learner_skill_state.p_mastery`.
 */
export function decayMastery(params: {
  p_mastery: number;
  observation_count: number;
  last_practiced_at: string | null;
  now?: Date;
}): number {
  const { p_mastery, observation_count, last_practiced_at } = params;
  if (!last_practiced_at) return p_mastery;

  const now = params.now ?? new Date();
  const daysElapsed = (now.getTime() - new Date(last_practiced_at).getTime()) / 86_400_000;
  if (!Number.isFinite(daysElapsed) || daysElapsed <= 0) return p_mastery;

  const stabilityDays = 7 * (1 + observation_count * 0.5);
  const decayed = p_mastery * Math.exp(-daysElapsed / stabilityDays);

  return Math.max(0, Math.min(p_mastery, decayed));
}
