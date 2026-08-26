/**
 * AI Interview Portal — server-only internals behind
 * src/lib/interview.functions.ts.
 *
 * Grounding: every interviewer question and every evaluation is built from
 * the SAME shared learner-context assembly as the Tutor
 * (`assembleTutorLearnerContext` with `{ interview: true }`) — a read-only,
 * plain-language snapshot. The interview NEVER writes mastery, responses,
 * plan history, replans, or any other PathMind state.
 *
 * Session lifecycle mirrors the calibration precedent
 * (src/lib/calibration.ts): one active session per learner, resume within
 * INTERVIEW_SESSION_MAX_AGE_MS, expire after it, `expired` is terminal.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { assembleTutorLearnerContext } from "@/lib/tutor.server";
import { DUPLICATE_WINDOW_MS } from "@/lib/tutor.shared";
import {
  INTERVIEW_ANSWER_MAX,
  INTERVIEW_DIFFICULTIES,
  INTERVIEW_DURATION_GRACE_MS,
  INTERVIEW_MAX_LEARNER_TURNS,
  INTERVIEW_SESSION_MAX_AGE_MS,
  INTERVIEW_TRANSCRIPT_MAX_CHARS,
  INTERVIEW_TYPES,
  type InterviewConfig,
  type InterviewEvaluationCategory,
  type InterviewEvaluationDTO,
  type InterviewSessionDTO,
  type InterviewSessionStatus,
  type InterviewSessionSummary,
  type InterviewTurn,
} from "@/lib/interview.shared";

type Db = SupabaseClient<Database>;

/* ---------------------------------------------------------------------- */
/* Config normalisation                                                    */
/* ---------------------------------------------------------------------- */

const TYPE_VALUES = new Set<string>(INTERVIEW_TYPES.map((t) => t.value));
const DIFFICULTY_VALUES = new Set<string>(INTERVIEW_DIFFICULTIES.map((d) => d.value));

/** Whitelist + clamp any stored/client config into the canonical shape. */
export function normalizeInterviewConfig(
  raw: unknown,
  fallbackRole: string | null,
): InterviewConfig {
  const r = (raw ?? {}) as Partial<Record<keyof InterviewConfig, unknown>>;
  const targetRole =
    String(r.targetRole ?? "")
      .trim()
      .slice(0, 120) ||
    fallbackRole ||
    "Software development";
  const interviewType = TYPE_VALUES.has(String(r.interviewType))
    ? (r.interviewType as InterviewConfig["interviewType"])
    : "mixed";
  const difficulty = DIFFICULTY_VALUES.has(String(r.difficulty))
    ? (r.difficulty as InterviewConfig["difficulty"])
    : "intermediate";
  const d = Number(r.durationMinutes);
  const durationMinutes = d === 15 || d === 40 ? d : 25;
  return { targetRole, interviewType, difficulty, durationMinutes };
}

type SessionRow = {
  id: string;
  config: unknown;
  status: string;
  started_at: string;
  ended_at: string | null;
};

function toSessionDTO(row: SessionRow): InterviewSessionDTO {
  return {
    id: row.id,
    config: normalizeInterviewConfig(row.config, null),
    status: row.status as InterviewSessionStatus,
    started_at: row.started_at,
    ended_at: row.ended_at,
  };
}

/* ---------------------------------------------------------------------- */
/* AI Gateway — same provider + friendly-error pattern as the Tutor        */
/* ---------------------------------------------------------------------- */

const GEMINI_MODEL = "gemini-3.6-flash";
const RETRYABLE_GEMINI_STATUS = new Set([429, 500, 502, 503, 504]);

async function fetchWithGeminiRetry<T>(request: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      const status =
        typeof error === "object" && error && "status" in error
          ? Number((error as { status?: number }).status)
          : 0;
      if (!RETRYABLE_GEMINI_STATUS.has(status) || attempt === 3) {
        throw error;
      }
      const delayMs = 250 * 2 ** attempt;
      console.warn(
        `[${label}] transient Gemini error, retrying in ${delayMs}ms (attempt ${attempt + 1}/3)`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function callInterviewModel(
  apiKey: string,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  maxTokens: number,
): Promise<string> {
  const systemMessage = messages.find((m) => m.role === "system");
  const conversationMessages = messages.filter((m) => m.role !== "system");

  const request = async (): Promise<string> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": apiKey,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: systemMessage
              ? {
                  parts: [{ text: systemMessage.content }],
                }
              : undefined,

            contents: conversationMessages.map((message) => ({
              role: message.role === "assistant" ? "model" : "user",
              parts: [{ text: message.content }],
            })),

            generationConfig: {
              maxOutputTokens: maxTokens,
              temperature: 0.3,
            },
          }),
        },
      );

      const rawText = await response.text();
      if (!response.ok) {
        const status = response.status;
        const detail = rawText.slice(0, 1000);
        const error = new Error(
          status === 429
            ? "Gemini is temporarily rate-limited — please wait a moment and try again."
            : status >= 500
              ? "Gemini is temporarily unavailable — please try again in a moment."
              : status === 404
                ? "The selected Gemini model is not available right now — please try again later."
                : `Gemini API returned HTTP ${status}: ${detail}`,
        ) as Error & { status?: number };
        error.status = status;
        throw error;
      }

      const payload = JSON.parse(rawText) as {
        candidates?: {
          content?: {
            parts?: { text?: string }[];
          };
        }[];
      };

      const text =
        payload.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? "")
          .join("")
          .trim() ?? "";

      if (!text) {
        throw new Error("The interviewer had trouble responding — please try again.");
      }

      return text;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("The interview is taking longer than expected — please try again.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  return fetchWithGeminiRetry(request, "INTERVIEW");
}
/* ---------------------------------------------------------------------- */
/* Prompts — grounded, plain-language, explicitly non-visual               */
/* ---------------------------------------------------------------------- */

const TYPE_GUIDANCE: Record<InterviewConfig["interviewType"], string> = {
  technical: "Technical interview: probe concepts, trade-offs, and how things work under the hood.",
  behavioral:
    "Behavioral interview: explore real experiences, decisions, teamwork, and how they handle setbacks. Invite concrete stories.",
  mixed:
    "Mixed interview: a realistic blend — alternate between technical depth and behavioral/experience questions.",
};

const DIFFICULTY_GUIDANCE: Record<InterviewConfig["difficulty"], string> = {
  foundation: "Foundational: core concepts, definitions, simple scenarios. Gentle follow-ups.",
  intermediate: "Intermediate: applied questions and realistic scenarios. Expect specifics.",
  advanced: "Advanced: deep probes, edge cases, design trade-offs. Respectful but real pressure.",
};

function interviewerSystemPrompt(
  config: InterviewConfig,
  signalsSummary: string,
  closing: boolean,
): string {
  return `You are a professional interviewer conducting a realistic mock ${config.interviewType} interview for the role: "${config.targetRole}".

Format:
- ${TYPE_GUIDANCE[config.interviewType]}
- ${DIFFICULTY_GUIDANCE[config.difficulty]}
- The candidate answers out loud; you receive a text transcript of what they said.

Real signals about this candidate (from their learning profile — use them, don't quote the mechanics):
${signalsSummary}

Rules:
- Ask exactly ONE question per message. Keep it to 1-3 sentences, spoken style.
- Adapt: probe vague answers for specifics; go deeper when an answer is strong; move on when it's clear they don't know.
- Connect questions to the real signals above when relevant — a verified weak spot, a hidden prerequisite gap, or their current focus. If no signal fits, ask a foundational role-appropriate question.
- Never invent weaknesses or achievements for the candidate, and never claim they said something they didn't.
- You CANNOT see or hear the candidate. Their camera is a private self-view that never leaves their device, and you only receive text transcripts. NEVER reference appearance, facial expressions, eye contact, body language, gestures, their surroundings, voice tone, filler words, or anything visual or audio. Judge only the substance of their answers.
- Plain, warm, professional language. No internal scores, probabilities, or system names.
- Output ONLY the interviewer's next message — no preamble, no labels, no quotation marks.${
    closing
      ? `

The interview is ending NOW. Instead of a question, write a brief, warm wrap-up (2-3 sentences): thank them, name one thing that came across well, and mention that their written evaluation is on its way. Do NOT ask another question.`
      : ""
  }`;
}

function transcriptText(turns: InterviewTurn[]): string {
  const joined = turns
    .map((t) => `${t.role === "learner" ? "Candidate" : "Interviewer"}: ${t.content}`)
    .join("\n\n");
  // Keep the most recent turns when the transcript is long.
  return joined.length > INTERVIEW_TRANSCRIPT_MAX_CHARS
    ? `…(earlier turns omitted)\n\n${joined.slice(-INTERVIEW_TRANSCRIPT_MAX_CHARS)}`
    : joined;
}

function buildInterviewerMessages(
  config: InterviewConfig,
  signalsSummary: string,
  turns: InterviewTurn[],
  closing: boolean,
): { role: "system" | "user" | "assistant"; content: string }[] {
  const system = interviewerSystemPrompt(config, signalsSummary, closing);
  if (turns.length === 0) {
    return [
      { role: "system", content: system },
      {
        role: "user",
        content:
          "Open the interview: greet the candidate briefly (one sentence) and ask your first question.",
      },
    ];
  }
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `Transcript so far:\n\n${transcriptText(turns)}\n\n${
        closing ? "Write the wrap-up now." : "Ask your next question."
      }`,
    },
  ];
}

const EVALUATION_CATEGORIES = [
  "Technical understanding",
  "Reasoning & problem solving",
  "Communication",
  "Depth of knowledge",
];

function buildEvaluationMessages(
  config: InterviewConfig,
  signalsSummary: string,
  turns: InterviewTurn[],
): { role: "system" | "user" | "assistant"; content: string }[] {
  return [
    {
      role: "system",
      content: `You are an interview assessor writing a candidate-facing evaluation for a mock ${config.interviewType} interview for the role: "${config.targetRole}".

Real signals about this candidate (context only — evaluate the TRANSCRIPT, not the profile):
${signalsSummary}

Rules:
- Evaluate ONLY what the transcript shows. Every strength and weakness must trace to answers actually given.
- If a category lacks evidence in the transcript, say so in its notes and use the label "Developing".
- You CANNOT see or hear the candidate. NEVER reference appearance, body language, eye contact, surroundings, voice, or delivery. Assess only the substance of their answers.
- Plain, warm, direct language the candidate can act on. No internal scores or system names.
- Respond with STRICT JSON only — no markdown fences, no commentary — in exactly this shape:
{
  "categories": [
    {"name": "Technical understanding", "label": "Strong|Developing|Needs work", "notes": "1-2 sentences"},
    {"name": "Reasoning & problem solving", "label": "Strong|Developing|Needs work", "notes": "1-2 sentences"},
    {"name": "Communication", "label": "Strong|Developing|Needs work", "notes": "1-2 sentences"},
    {"name": "Depth of knowledge", "label": "Strong|Developing|Needs work", "notes": "1-2 sentences"}
  ],
  "strengths": ["3-5 short bullets"],
  "weaknesses": ["2-5 short bullets — areas needing more preparation, phrased constructively"],
  "readiness_notes": "2-4 sentences: an honest readiness observation for the target role, and what to focus on next."
}`,
    },
    {
      role: "user",
      content: `Full transcript:\n\n${transcriptText(turns)}\n\nWrite the evaluation JSON now.`,
    },
  ];
}

/* ---------------------------------------------------------------------- */
/* Evaluation parsing — salvage-first, never crash on a messy model reply  */
/* ---------------------------------------------------------------------- */

const LABELS = new Set(["Strong", "Developing", "Needs work"]);

function parseEvaluationJson(text: string): {
  categories: InterviewEvaluationCategory[];
  strengths: string[];
  weaknesses: string[];
  readiness_notes: string | null;
} {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start)
    throw new Error("The evaluation couldn't be generated — please try again.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The evaluation couldn't be generated — please try again.");
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const rawCats = Array.isArray(obj["categories"]) ? (obj["categories"] as unknown[]) : [];
  const categories: InterviewEvaluationCategory[] = rawCats
    .map((c) => {
      const r = (c ?? {}) as Record<string, unknown>;
      const name = String(r["name"] ?? "").trim();
      if (!name) return null;
      const labelRaw = String(r["label"] ?? "").trim();
      return {
        name: name.slice(0, 80),
        label: (LABELS.has(labelRaw)
          ? labelRaw
          : "Developing") as InterviewEvaluationCategory["label"],
        notes: String(r["notes"] ?? "")
          .trim()
          .slice(0, 600),
      };
    })
    .filter((c): c is InterviewEvaluationCategory => Boolean(c));
  // Guarantee the four canonical categories exist even if the model skipped one.
  for (const name of EVALUATION_CATEGORIES) {
    if (!categories.some((c) => c.name === name)) {
      categories.push({
        name,
        label: "Developing",
        notes: "Not enough evidence in this interview to assess this area.",
      });
    }
  }
  const asBullets = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : [])
      .map((s) => String(s ?? "").trim())
      .filter(Boolean)
      .slice(0, max);
  return {
    categories,
    strengths: asBullets(obj["strengths"], 5),
    weaknesses: asBullets(obj["weaknesses"], 5),
    readiness_notes: obj["readiness_notes"]
      ? String(obj["readiness_notes"]).trim().slice(0, 1200)
      : null,
  };
}

function rowToEvaluation(row: {
  id: string;
  session_id: string;
  categories: unknown;
  strengths: unknown;
  weaknesses: unknown;
  readiness_notes: string | null;
  created_at: string;
}): InterviewEvaluationDTO {
  return {
    id: row.id,
    session_id: row.session_id,
    categories: (Array.isArray(row.categories)
      ? row.categories
      : []) as InterviewEvaluationCategory[],
    strengths: (Array.isArray(row.strengths) ? row.strengths : []) as string[],
    weaknesses: (Array.isArray(row.weaknesses) ? row.weaknesses : []) as string[],
    readiness_notes: row.readiness_notes,
    created_at: row.created_at,
  };
}

/* ---------------------------------------------------------------------- */
/* Session lifecycle — mirrors calibration.ts                              */
/* ---------------------------------------------------------------------- */

async function loadTurns(supabase: Db, sessionId: string): Promise<InterviewTurn[]> {
  const { data, error } = await supabase
    .from("interview_turns")
    .select("id, role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw new Error("We couldn't load the interview — please try again.");
  return (data ?? []) as InterviewTurn[];
}

async function learnerTurnCount(supabase: Db, sessionId: string): Promise<number> {
  const { count, error } = await supabase
    .from("interview_turns")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("role", "learner");
  if (error) throw new Error("We couldn't load the interview — please try again.");
  return count ?? 0;
}

async function findSession(
  supabase: Db,
  userId: string,
  sessionId: string,
): Promise<SessionRow | null> {
  const { data, error } = await supabase
    .from("interview_sessions")
    .select("id, config, status, started_at, ended_at")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("We couldn't open that interview — please try again.");
  return (data as SessionRow | null) ?? null;
}

function isStale(startedAt: string): boolean {
  return Date.now() - new Date(startedAt).getTime() > INTERVIEW_SESSION_MAX_AGE_MS;
}

async function requireApiKey(): Promise<string> {
  const apiKey = process.env["GEMINI_API_KEY"];

  if (!apiKey) {
    throw new Error("The interviewer isn't configured yet.");
  }

  return apiKey;
}

/**
 * Idempotent first question: generates and persists the opening interviewer
 * turn only when the session has no turns yet (safe on retries and refresh).
 */
async function ensureFirstQuestion(
  supabase: Db,
  userId: string,
  sessionId: string,
  config: InterviewConfig,
): Promise<void> {
  const { count, error } = await supabase
    .from("interview_turns")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (error) throw new Error("We couldn't load the interview — please try again.");
  if ((count ?? 0) > 0) return;

  const context = await assembleTutorLearnerContext(supabase, userId, { interview: true });
  const apiKey = await requireApiKey();
  const first = await callInterviewModel(
    apiKey,
    buildInterviewerMessages(config, context.interview?.promptSummary ?? "", [], false),
    900,
  );
  // Re-check right before insert: a concurrent retry may have beaten us.
  const { count: recount } = await supabase
    .from("interview_turns")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if ((recount ?? 0) > 0) return;
  const { error: insertError } = await supabase.from("interview_turns").insert({
    session_id: sessionId,
    role: "interviewer",
    content: first,
  });
  if (insertError) throw new Error("We couldn't start the interview — please try again.");
}

export type InterviewSessionWithTurns = {
  session: InterviewSessionDTO;
  turns: InterviewTurn[];
  resumed: boolean;
};

/** Create-or-resume: exactly one active interview session per learner. */
export async function startInterviewSessionImpl(
  supabase: Db,
  userId: string,
  rawConfig: unknown,
): Promise<InterviewSessionWithTurns> {
  // Newest in-progress session wins — same rule as calibration.
  const { data: active, error: activeError } = await supabase
    .from("interview_sessions")
    .select("id, config, status, started_at, ended_at")
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeError) throw new Error("We couldn't start the interview — please try again.");

  const activeRow = (active as SessionRow | null) ?? null;
  if (activeRow && !isStale(activeRow.started_at)) {
    const config = normalizeInterviewConfig(activeRow.config, null);
    await ensureFirstQuestion(supabase, userId, activeRow.id, config);
    return {
      session: toSessionDTO(activeRow),
      turns: await loadTurns(supabase, activeRow.id),
      resumed: true,
    };
  }

  // Expire every stale in-progress session before creating the new one.
  const { error: expireError } = await supabase
    .from("interview_sessions")
    .update({ status: "expired" })
    .eq("user_id", userId)
    .eq("status", "in_progress");
  if (expireError) throw new Error("We couldn't start the interview — please try again.");

  // Config fallback comes from the shared learner context (real goal).
  const context = await assembleTutorLearnerContext(supabase, userId, { interview: true });
  const config = normalizeInterviewConfig(rawConfig, context.interview?.targetRole ?? null);

  const { data: created, error: createError } = await supabase
    .from("interview_sessions")
    .insert({ user_id: userId, config: config as never })
    .select("id, config, status, started_at, ended_at")
    .single();
  if (createError || !created)
    throw new Error("We couldn't start the interview — please try again.");

  const session = toSessionDTO(created as SessionRow);
  await ensureFirstQuestion(supabase, userId, session.id, config);
  return { session, turns: await loadTurns(supabase, session.id), resumed: false };
}

/** Resume-by-id for the live screen (mount/refresh). Never creates sessions. */
export async function openInterviewSessionImpl(
  supabase: Db,
  userId: string,
  sessionId: string,
): Promise<InterviewSessionWithTurns> {
  const row = await findSession(supabase, userId, sessionId);
  if (!row) throw new Error("That interview could not be found.");
  if (row.status === "in_progress" && isStale(row.started_at)) {
    await supabase
      .from("interview_sessions")
      .update({ status: "expired", ended_at: new Date().toISOString() })
      .eq("id", row.id);
    row.status = "expired";
  }
  const session = toSessionDTO(row);
  if (session.status === "in_progress") {
    await ensureFirstQuestion(supabase, userId, session.id, session.config);
  }
  return { session, turns: await loadTurns(supabase, session.id), resumed: true };
}

/** Pure read for the results screen: session + turns + evaluation if any. */
export async function getInterviewSessionImpl(
  supabase: Db,
  userId: string,
  sessionId: string,
): Promise<{
  session: InterviewSessionDTO;
  turns: InterviewTurn[];
  evaluation: InterviewEvaluationDTO | null;
}> {
  const row = await findSession(supabase, userId, sessionId);
  if (!row) throw new Error("That interview could not be found.");
  const [turns, evalRes] = await Promise.all([
    loadTurns(supabase, row.id),
    supabase.from("interview_evaluations").select("*").eq("session_id", row.id).maybeSingle(),
  ]);
  return {
    session: toSessionDTO(row),
    turns,
    evaluation: evalRes.data ? rowToEvaluation(evalRes.data) : null,
  };
}

export async function listInterviewSessionsImpl(
  supabase: Db,
  userId: string,
): Promise<InterviewSessionSummary[]> {
  const { data, error } = await supabase
    .from("interview_sessions")
    .select("id, config, status, started_at, ended_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(8);
  if (error) throw new Error("We couldn't load your interviews — please try again.");
  const rows = (data ?? []) as SessionRow[];
  const ids = rows.map((r) => r.id);
  const { data: evals } = ids.length
    ? await supabase.from("interview_evaluations").select("session_id").in("session_id", ids)
    : { data: [] as { session_id: string }[] };
  const evaluated = new Set((evals ?? []).map((e) => e.session_id));
  return rows.map((r) => ({ ...toSessionDTO(r), has_evaluation: evaluated.has(r.id) }));
}

export async function abandonInterviewSessionImpl(
  supabase: Db,
  userId: string,
  sessionId: string,
): Promise<{ ok: true }> {
  const row = await findSession(supabase, userId, sessionId);
  if (!row) throw new Error("That interview could not be found.");
  if (row.status === "in_progress") {
    const { error } = await supabase
      .from("interview_sessions")
      .update({ status: "abandoned", ended_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) throw new Error("We couldn't end that interview — please try again.");
  }
  return { ok: true };
}

/* ---------------------------------------------------------------------- */
/* Answer submission — persist-before-generate + duplicate guard           */
/* ---------------------------------------------------------------------- */

export type SubmitAnswerResult = {
  /** The interviewer's new message (null when the interview was already over). */
  turn: InterviewTurn | null;
  finished: boolean;
  duplicated: boolean;
  learnerTurns: number;
};

export async function submitInterviewAnswerImpl(
  supabase: Db,
  userId: string,
  sessionId: string,
  rawText: string,
): Promise<SubmitAnswerResult> {
  const text = rawText.trim();
  if (!text) throw new Error("Say or type an answer first.");
  // Hard answer limit — enforced BEFORE any AI call.
  if (text.length > INTERVIEW_ANSWER_MAX) {
    throw new Error(
      `That answer is a little long. Try keeping it under ${INTERVIEW_MAX_CHARS_LABEL}.`,
    );
  }

  const row = await findSession(supabase, userId, sessionId);
  if (!row) throw new Error("That interview could not be found.");
  if (row.status !== "in_progress") throw new Error("This interview has already ended.");
  const session = toSessionDTO(row);

  // Duplicate guard — identical discipline to the Tutor: look at the latest
  // exchange before inserting anything.
  const { data: tail, error: tailError } = await supabase
    .from("interview_turns")
    .select("id, role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(2);
  if (tailError) throw new Error("We couldn't load the interview — please try again.");
  const last = tail?.[0] ?? null;
  const prev = tail?.[1] ?? null;
  const isRecent = (iso: string) => Date.now() - new Date(iso).getTime() < DUPLICATE_WINDOW_MS;

  // Identical answer already answered moments ago → return the existing reply.
  if (
    last?.role === "interviewer" &&
    prev?.role === "learner" &&
    prev.content === text &&
    isRecent(prev.created_at)
  ) {
    return {
      turn: last as InterviewTurn,
      finished: await isFinished(supabase, session),
      duplicated: true,
      learnerTurns: await learnerTurnCount(supabase, sessionId),
    };
  }

  // Identical answer persisted but never answered (AI failed last time) →
  // answer the existing row instead of inserting a duplicate.
  const reuseExisting =
    last?.role === "learner" && last.content === text && isRecent(last.created_at);
  if (!reuseExisting) {
    const { error: insertError } = await supabase.from("interview_turns").insert({
      session_id: sessionId,
      role: "learner",
      content: text,
    });
    if (insertError) throw new Error("We couldn't save your answer — please try again.");
  }

  const count = await learnerTurnCount(supabase, sessionId);
  const finished = await isFinished(supabase, session);
  if (count > INTERVIEW_MAX_LEARNER_TURNS) {
    // Defensive: cap was already passed by an earlier answer — no more AI calls.
    return { turn: null, finished: true, duplicated: false, learnerTurns: count };
  }

  const turns = await loadTurns(supabase, sessionId);
  const context = await assembleTutorLearnerContext(supabase, userId, { interview: true });
  const apiKey = await requireApiKey();
  const reply = await callInterviewModel(
    apiKey,
    buildInterviewerMessages(
      session.config,
      context.interview?.promptSummary ?? "",
      turns,
      finished,
    ),
    900,
  );

  const { data: saved, error: saveError } = await supabase
    .from("interview_turns")
    .insert({ session_id: sessionId, role: "interviewer", content: reply })
    .select("id, role, content, created_at")
    .single();
  if (saveError || !saved)
    throw new Error("We couldn't save the next question — please try again.");

  return { turn: saved as InterviewTurn, finished, duplicated: false, learnerTurns: count };
}

const INTERVIEW_MAX_CHARS_LABEL = `${INTERVIEW_ANSWER_MAX.toLocaleString()} characters`;

/** Turn cap reached, or configured duration exceeded (plus grace). */
async function isFinished(supabase: Db, session: InterviewSessionDTO): Promise<boolean> {
  const count = await learnerTurnCount(supabase, session.id);
  if (count >= INTERVIEW_MAX_LEARNER_TURNS) return true;
  const elapsed = Date.now() - new Date(session.started_at).getTime();
  return elapsed > session.config.durationMinutes * 60_000 + INTERVIEW_DURATION_GRACE_MS;
}

/* ---------------------------------------------------------------------- */
/* Completion + evaluation — exactly one evaluation per session            */
/* ---------------------------------------------------------------------- */

export type CompleteInterviewResult = {
  evaluation: InterviewEvaluationDTO | null;
  duplicated: boolean;
};

export async function completeInterviewSessionImpl(
  supabase: Db,
  userId: string,
  sessionId: string,
): Promise<CompleteInterviewResult> {
  const row = await findSession(supabase, userId, sessionId);
  if (!row) throw new Error("That interview could not be found.");
  if (row.status === "expired") throw new Error("This interview has expired.");
  if (row.status === "abandoned")
    throw new Error("This interview was ended without an evaluation.");

  // Idempotent + refresh-safe: an existing evaluation is returned as-is.
  const { data: existing } = await supabase
    .from("interview_evaluations")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (existing) return { evaluation: rowToEvaluation(existing), duplicated: true };

  const turns = await loadTurns(supabase, sessionId);
  const hasAnswers = turns.some((t) => t.role === "learner");
  if (!hasAnswers) {
    // Nothing to evaluate — close the session honestly instead of inventing one.
    await supabase
      .from("interview_sessions")
      .update({ status: "abandoned", ended_at: new Date().toISOString() })
      .eq("id", sessionId);
    return { evaluation: null, duplicated: false };
  }

  const session = toSessionDTO(row);
  const context = await assembleTutorLearnerContext(supabase, userId, { interview: true });
  const apiKey = await requireApiKey();
  const raw = await callInterviewModel(
    apiKey,
    buildEvaluationMessages(session.config, context.interview?.promptSummary ?? "", turns),
    1500,
  );
  const parsed = parseEvaluationJson(raw);

  const { data: inserted, error: insertError } = await supabase
    .from("interview_evaluations")
    .insert({
      session_id: sessionId,
      categories: parsed.categories as never,
      strengths: parsed.strengths as never,
      weaknesses: parsed.weaknesses as never,
      readiness_notes: parsed.readiness_notes,
    })
    .select("*")
    .single();
  if (insertError) {
    // UNIQUE(session_id): a concurrent retry already wrote the evaluation.
    const { data: raced } = await supabase
      .from("interview_evaluations")
      .select("*")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (raced) return { evaluation: rowToEvaluation(raced), duplicated: true };
    throw new Error("We couldn't save your evaluation — please try again.");
  }

  await supabase
    .from("interview_sessions")
    .update({ status: "completed", ended_at: new Date().toISOString() })
    .eq("id", sessionId);
  return { evaluation: rowToEvaluation(inserted), duplicated: false };
}
