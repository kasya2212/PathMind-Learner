import { supabase } from "@/integrations/supabase/client";
import { fetchDiagnosticItems, type DiagnosticItem } from "@/lib/pathmind";

export type SkillLevel = "beginner" | "intermediate" | "advanced";

export const SKILL_LEVELS: { value: SkillLevel; label: string; hint: string }[] = [
  { value: "beginner", label: "Beginner", hint: "New to backend development" },
  { value: "intermediate", label: "Intermediate", hint: "I've built a few projects" },
  { value: "advanced", label: "Advanced", hint: "I work with this professionally" },
];

/** Where the adaptive engine starts probing for each self-rated level. */
export const START_DIFFICULTY: Record<SkillLevel, number> = {
  beginner: 0.22,
  intermediate: 0.48,
  advanced: 0.72,
};

export const CALIBRATION_LENGTH = 8;

export type CalibrationSummary = {
  correct: number;
  total: number;
  strengths: string[];
  improvements: string[];
  perNode: { nodeId: string; name: string; correct: number; total: number }[];
};

/**
 * Picks the next question.
 *
 * Rotation rules, in order:
 *  1. never repeat an item already used in this session,
 *  2. strongly prefer items the learner has never seen in any past session,
 *  3. spread across the focus topics (round-robin on least-asked node),
 *  4. within that, choose the item closest to the current target difficulty.
 */
export function pickNextItem(params: {
  pool: DiagnosticItem[];
  usedInSession: Set<string>;
  seenBefore: Set<string>;
  askedPerNode: Map<string, number>;
  targetDifficulty: number;
}): DiagnosticItem | null {
  const { pool, usedInSession, seenBefore, askedPerNode, targetDifficulty } = params;

  const available = pool.filter((i) => !usedInSession.has(i.id));
  if (available.length === 0) return null;

  const fresh = available.filter((i) => !seenBefore.has(i.id));
  const candidates = fresh.length > 0 ? fresh : available;

  const minAsked = Math.min(
    ...candidates.map((i) => askedPerNode.get(i.skill_node_id) ?? 0),
  );
  const balanced = candidates.filter(
    (i) => (askedPerNode.get(i.skill_node_id) ?? 0) === minAsked,
  );

  return [...balanced].sort(
    (a, b) =>
      Math.abs(Number(a.difficulty) - targetDifficulty) -
      Math.abs(Number(b.difficulty) - targetDifficulty),
  )[0] ?? null;
}

/** Adaptive step: harder after a correct answer, easier after a wrong one. */
export function nextTargetDifficulty(current: number, correct: boolean) {
  const step = correct ? 0.14 : -0.16;
  return Math.min(0.9, Math.max(0.1, current + step));
}

export async function fetchSeenItemIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("learner_responses")
    .select("item_id")
    .eq("user_id", userId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.item_id).filter((id): id is string => Boolean(id)));
}

/** Sessions abandoned longer than this are expired rather than resumed. */
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ResumedResponse = {
  item_id: string | null;
  skill_node_id: string;
  selected_option_id: string | null;
  correct: boolean;
  difficulty: number | null;
};

export type ResumableSession = {
  sessionId: string;
  startedAt: string;
  responses: ResumedResponse[];
};

/**
 * Finds the learner's newest still-usable calibration session so a refresh or
 * a lost tab resumes instead of restarting. Stale sessions are expired.
 */
export async function getResumableSession(userId: string): Promise<ResumableSession | null> {
  const { data: session, error } = await supabase
    .from("calibration_sessions")
    .select("id, started_at")
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!session) return null;

  const age = Date.now() - new Date(session.started_at).getTime();
  if (age > SESSION_MAX_AGE_MS) {
    await supabase
      .from("calibration_sessions")
      .update({ status: "expired" })
      .eq("id", session.id)
      .eq("user_id", userId);
    return null;
  }

  const { data: responses, error: responsesError } = await supabase
    .from("learner_responses")
    .select("item_id, skill_node_id, selected_option_id, correct, difficulty, created_at")
    .eq("user_id", userId)
    .eq("session_id", session.id)
    .order("created_at", { ascending: true });
  if (responsesError) throw responsesError;

  return { sessionId: session.id, startedAt: session.started_at, responses: responses ?? [] };
}

/**
 * Starts a fresh session. Any other in-progress sessions for this learner are
 * expired first so exactly one session is ever active.
 */
export async function startCalibrationSession(userId: string) {
  await supabase
    .from("calibration_sessions")
    .update({ status: "expired" })
    .eq("user_id", userId)
    .eq("status", "in_progress");

  const { data, error } = await supabase
    .from("calibration_sessions")
    .insert({ user_id: userId, status: "in_progress" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function loadItemPool(nodeIds: string[]) {
  if (nodeIds.length === 0) return [] as DiagnosticItem[];
  return fetchDiagnosticItems(nodeIds);
}

// NOTE: mastery is written exclusively by the `updateMastery` server function
// (BKT, server-side). The old client-side heuristic writer was removed so no
// answer can ever produce two different mastery records.

export async function completeCalibrationSession(params: {
  userId: string;
  sessionId: string;
  itemIds: string[];
  summary: CalibrationSummary;
}) {
  const { userId, sessionId, itemIds, summary } = params;

  await supabase
    .from("calibration_sessions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      item_ids: itemIds,
      summary: summary as unknown as never,
    })
    .eq("id", sessionId)
    .eq("user_id", userId);

  await supabase.from("plan_history").insert({
    user_id: userId,
    trigger: "calibration",
    summary: `Calibration complete — ${summary.correct}/${summary.total} correct`,
    reasoning:
      summary.strengths.length > 0
        ? `Strong on ${summary.strengths.join(", ")}. Focus next on ${summary.improvements.join(", ") || "your unlocked skills"}.`
        : `Focus next on ${summary.improvements.join(", ") || "the fundamentals"}.`,
  });
}
