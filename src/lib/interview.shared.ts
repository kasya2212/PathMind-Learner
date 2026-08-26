/**
 * AI Interview Portal — client-safe constants and DTO types shared by the
 * routes, the server functions and the server implementation. No runtime
 * server code lives here.
 */

/**
 * Resume window for an in-progress interview session (calibration-style
 * lifecycle: resume within the window, expire after it). Interviews are
 * short, so the window is much shorter than calibration's 24h.
 */
export const INTERVIEW_SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000;

/**
 * Turn cap — maximum learner-answer turns per interview.
 * One turn = one learner answer plus the interviewer's single follow-up
 * message it triggers. The opening question does not consume a turn; the
 * closing wrap-up and the final evaluation are not turns either.
 */
export const INTERVIEW_MAX_LEARNER_TURNS = 12;

/** Hard learner-answer length limit — enforced server-side BEFORE any AI call. */
export const INTERVIEW_ANSWER_MAX = 4000;

/** Grace period after the configured duration before the server forces a wrap-up. */
export const INTERVIEW_DURATION_GRACE_MS = 2 * 60 * 1000;

/** Transcript size cap sent to the model (evaluation + question prompts). */
export const INTERVIEW_TRANSCRIPT_MAX_CHARS = 24_000;

export const INTERVIEW_TYPES = [
  { value: "technical", label: "Technical", hint: "Concepts, trade-offs, how things work" },
  { value: "behavioral", label: "Behavioral", hint: "Experience, teamwork, decisions" },
  { value: "mixed", label: "Mixed", hint: "A realistic blend of both" },
] as const;

export const INTERVIEW_DIFFICULTIES = [
  { value: "foundation", label: "Foundational", hint: "Core concepts, gentle follow-ups" },
  { value: "intermediate", label: "Intermediate", hint: "Applied questions, real scenarios" },
  { value: "advanced", label: "Advanced", hint: "Deep probes, edge cases, pressure" },
] as const;

export const INTERVIEW_DURATIONS = [15, 25, 40] as const;

export type InterviewType = (typeof INTERVIEW_TYPES)[number]["value"];
export type InterviewDifficulty = (typeof INTERVIEW_DIFFICULTIES)[number]["value"];

export type InterviewConfig = {
  targetRole: string;
  interviewType: InterviewType;
  difficulty: InterviewDifficulty;
  durationMinutes: number;
};

export type InterviewTurn = {
  id: string;
  role: "interviewer" | "learner";
  content: string;
  created_at: string;
};

export type InterviewSessionStatus = "in_progress" | "completed" | "abandoned" | "expired";

export type InterviewSessionDTO = {
  id: string;
  config: InterviewConfig;
  status: InterviewSessionStatus;
  started_at: string;
  ended_at: string | null;
};

export type InterviewEvaluationLabel = "Strong" | "Developing" | "Needs work";

export type InterviewEvaluationCategory = {
  name: string;
  label: InterviewEvaluationLabel;
  notes: string;
};

export type InterviewEvaluationDTO = {
  id: string;
  session_id: string;
  categories: InterviewEvaluationCategory[];
  strengths: string[];
  weaknesses: string[];
  readiness_notes: string | null;
  created_at: string;
};

export type InterviewSessionSummary = InterviewSessionDTO & { has_evaluation: boolean };
