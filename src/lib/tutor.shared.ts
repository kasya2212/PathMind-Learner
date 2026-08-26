/**
 * AI Tutor — client-safe constants and DTO types shared by the route UI,
 * the server functions and the server-side implementation. No runtime
 * server code lives here.
 */

/** Hard learner-message length limit — enforced server-side BEFORE any AI call. */
export const TUTOR_MESSAGE_MAX = 2000;

/**
 * AI history cap: ONLY the latest N stored messages (≈10 exchanges) are sent
 * to the model. Older messages stay persisted and visible in the UI — they
 * are simply not part of the AI request.
 */
export const AI_HISTORY_LIMIT = 20;

/** Window for the lightweight duplicate-submit guard (retry / double-click). */
export const DUPLICATE_WINDOW_MS = 90_000;

export type TutorMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type TutorConversationSummary = {
  id: string;
  created_at: string;
  last_message_at: string | null;
  /** First learner message, truncated — used as the conversation label. */
  preview: string | null;
};

export type TutorSkillStatus = { name: string; status: string };

/**
 * The shared Tutor learner-context DTO. `assembleTutorLearnerContext`
 * (server) is the SINGLE source that produces it; both the AI prompt and
 * the "Your Path" panel consume this exact shape.
 *
 * Everything here is plain learner-facing language — never raw internal
 * scores, probabilities, IDs or system names.
 */
export type TutorLearnerContext = {
  displayName: string | null;
  goalText: string | null;
  goalName: string | null;
  domainLabel: string;
  nextStep: { name: string; why: string } | null;
  /** In-flight skills with a plain-language status (e.g. "Building confidence"). */
  inProgress: TutorSkillStatus[];
  /** Skills with a solid grasp. */
  strong: string[];
  /** Scoped path skills with no assessment yet. */
  unstarted: string[];
  /** Previously solid skills whose retention has faded (spaced review). */
  fading: string[];
  /** Hidden prerequisite gap names. */
  hiddenGaps: string[];
  /** Active (unresolved) bridge module titles. */
  activeBridges: string[];
  /** Next distinct roadmap entries. */
  upcoming: { name: string; minutes: number; isGap: boolean }[];
  dailyMinutes: number | null;
  daysLeft: number | null;
  learningStyle: string | null;
  /** False when the learner has zero BKT observations (no calibration yet). */
  hasAnyAssessment: boolean;
  /** Pre-rendered plain-language snapshot — the ONLY learner context the AI sees. */
  promptSummary: string;
  /**
   * Interview-only extension. Present ONLY when the assembly is called with
   * `{ interview: true }` (the AI Interview portal); the Tutor path never
   * receives it. Read-only view of the same underlying data.
   */
  interview?: InterviewLearnerSignals;
};

/* ---------------------------------------------------------------------- */
/* AI Interview extension of the shared learner context                    */
/* ---------------------------------------------------------------------- */

/**
 * A skill counts as "verified" for interview targeting once it has at least
 * this many real observations — a single noisy answer doesn't qualify.
 */
export const INTERVIEW_VERIFIED_MIN_OBSERVATIONS = 2;

export type InterviewLearnerSignals = {
  /** Plain-language target role/domain, derived from the learner's real goal. */
  targetRole: string | null;
  /** Weakest VERIFIED skills (lowest decayed grasp among sufficiently assessed). */
  weakestVerified: string[];
  /** Hidden prerequisite gap names (same read-only list as the base context). */
  hiddenGaps: string[];
  /** Current recommended focus — the plan's next step. */
  recommendedFocus: string | null;
  /** Pre-rendered plain-language block — the only learner data interview prompts see. */
  promptSummary: string;
};
