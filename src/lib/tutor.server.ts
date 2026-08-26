/**
 * AI Tutor — server-only internals behind src/lib/tutor.functions.ts.
 *
 * `assembleTutorLearnerContext` is the SINGLE shared learner-context
 * assembly for the Tutor: the AI prompt and the "Your Path" panel both
 * consume its result, so the two surfaces can never drift apart. It only
 * READS the existing PathMind tables and reuses the existing pure engines
 * (decayMastery, goalSubgraph, recommendNext, buildTrainingPlan,
 * isReviewDue, masteryLabel). It never writes mastery, never fabricates
 * observations, never replans, and never duplicates those systems.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { decayMastery } from "@/lib/bkt";
import { isReviewDue } from "@/lib/evidence";
import { goalSubgraph } from "@/lib/graph";
import { masteryLabel } from "@/lib/mastery";
import {
  DOMAIN,
  LEARNING_STYLES,
  MASTERED,
  recommendNext,
  type SkillEdge,
  type SkillNode,
} from "@/lib/pathmind";
import { buildTrainingPlan } from "@/lib/plan";
import { HARD_PREREQ_WEIGHT } from "@/lib/replan";
import {
  AI_HISTORY_LIMIT,
  DUPLICATE_WINDOW_MS,
  INTERVIEW_VERIFIED_MIN_OBSERVATIONS,
  TUTOR_MESSAGE_MAX,
  type TutorConversationSummary,
  type TutorLearnerContext,
  type TutorMessage,
} from "@/lib/tutor.shared";

type Db = SupabaseClient<Database>;

type StateRow = {
  skill_node_id: string;
  p_mastery: number;
  observation_count: number;
  last_practiced_at: string | null;
  source: string | null;
};

/** Mirror of RESOLVED_BRIDGE_STATUSES in replan.functions.ts (read side). */
const RESOLVED_BRIDGE_STATUSES = new Set(["complete", "completed", "resolved", "done"]);

const LEARNING_STYLE_LABELS = new Map(LEARNING_STYLES.map((s) => [s.value, s.label]));

/* ---------------------------------------------------------------------- */
/* Shared learner-context assembly (single source of Tutor context)        */
/* ---------------------------------------------------------------------- */

export async function assembleTutorLearnerContext(
  supabase: Db,
  userId: string,
  opts?: { interview?: boolean },
): Promise<TutorLearnerContext> {
  const [profileRes, statesRes, bridgesRes] = await Promise.all([
    supabase
      .from("learner_constraints")
      .select(
        "display_name, goal_text, goal_node_id, learning_style, subjects, daily_time_minutes, deadline_date",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("learner_skill_state")
      .select("skill_node_id, p_mastery, observation_count, last_practiced_at, source")
      .eq("user_id", userId),
    supabase.from("bridge_modules").select("title, status").eq("user_id", userId),
  ]);
  if (profileRes.error) throw new Error(profileRes.error.message);
  if (statesRes.error) throw new Error(statesRes.error.message);

  const profile = profileRes.data;
  const states = (statesRes.data ?? []) as StateRow[];

  // Resolve the learner's persisted goal node (source of truth for domain).
  let goalNode: { id: string; name: string; domain: string } | null = null;
  if (profile?.goal_node_id) {
    const { data } = await supabase
      .from("skill_nodes")
      .select("id, name, domain")
      .eq("id", profile.goal_node_id)
      .maybeSingle();
    goalNode = data ?? null;
  }
  const domain = goalNode?.domain ?? DOMAIN;

  const [nodesRes, edgesRes] = await Promise.all([
    supabase.from("skill_nodes").select("*").eq("domain", domain),
    supabase.from("skill_edges").select("*"),
  ]);
  if (nodesRes.error) throw new Error(nodesRes.error.message);
  if (edgesRes.error) throw new Error(edgesRes.error.message);
  const nodes = (nodesRes.data ?? []) as SkillNode[];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = ((edgesRes.data ?? []) as SkillEdge[]).filter(
    (e) => nodeIds.has(e.from_node_id) && nodeIds.has(e.to_node_id),
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nameOf = (id: string) => byId.get(id)?.name ?? null;

  // Decayed mastery — same forgetting-curve read the rest of the app uses.
  const decayed = new Map<string, number>();
  for (const s of states) {
    decayed.set(
      s.skill_node_id,
      decayMastery({
        p_mastery: Number(s.p_mastery),
        observation_count: Number(s.observation_count),
        last_practiced_at: s.last_practiced_at,
      }),
    );
  }

  const scoped = goalSubgraph({
    nodes,
    edges,
    goalId: goalNode?.id ?? null,
    subjectNames: (profile?.subjects as string[] | null) ?? [],
  });
  const scopedIds = new Set(scoped.nodes.map((n) => n.id));

  // Hidden prerequisite gaps — the read-only side of detect_hidden_gaps:
  // hard-prereq closure of the goal, minus anything with real observations.
  const hiddenGapIds = new Set<string>();
  if (goalNode) {
    const hard = edges.filter((e) => Number(e.weight) >= HARD_PREREQ_WEIGHT);
    const closure = new Set<string>();
    const queue = [goalNode.id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of hard) {
        if (e.to_node_id !== cur || closure.has(e.from_node_id)) continue;
        closure.add(e.from_node_id);
        queue.push(e.from_node_id);
      }
    }
    const observed = new Set(
      states.filter((s) => Number(s.observation_count) > 0).map((s) => s.skill_node_id),
    );
    for (const id of closure) if (!observed.has(id)) hiddenGapIds.add(id);
  }

  const next = scoped.nodes.length
? recommendNext(scoped.nodes, scoped.edges, decayed)
    : null;

  const plan = buildTrainingPlan({
    nodes: scoped.nodes,
    edges: scoped.edges,
    mastery: decayed,
    hiddenGapIds,
    dailyMinutes: profile?.daily_time_minutes ?? 45,
    deadline: profile?.deadline_date ?? null,
  });

  const upcoming: TutorLearnerContext["upcoming"] = [];
  const seenInPlan = new Set<string>();
  for (const entry of plan) {
    if (seenInPlan.has(entry.node.id)) continue;
    seenInPlan.add(entry.node.id);
    upcoming.push({ name: entry.node.name, minutes: entry.minutes, isGap: entry.isHiddenGap });
    if (upcoming.length >= 4) break;
  }

  const strong: string[] = [];
  const inProgress: TutorLearnerContext["inProgress"] = [];
  const unstarted: string[] = [];
  const stateByNode = new Map(states.map((s) => [s.skill_node_id, s]));
  for (const n of scoped.nodes) {
    const st = stateByNode.get(n.id);
    if (!st) {
      unstarted.push(n.name);
      continue;
    }
    const d = decayed.get(n.id) ?? 0;
    if (d >= MASTERED) strong.push(n.name);
    else inProgress.push({ name: n.name, status: masteryLabel(d) });
  }

  // Spaced review — the unchanged deterministic rule from evidence.ts,
  // restricted to nodes in the learner's current domain graph.
  const fading = states
    .filter((s) => nodeIds.has(s.skill_node_id))
    .filter((s) => isReviewDue(s, decayed.get(s.skill_node_id)))
    .map((s) => nameOf(s.skill_node_id))
    .filter((n): n is string => Boolean(n));

  const activeBridges = (bridgesRes.data ?? [])
    .filter((b) => !RESOLVED_BRIDGE_STATUSES.has(String(b.status)))
    .map((b) => String(b.title));

  let nextStep: TutorLearnerContext["nextStep"] = null;
  if (next) {
    const prereqIds = edges.filter((e) => e.to_node_id === next.id).map((e) => e.from_node_id);
    const prereqNames = prereqIds
      .map((id) => nameOf(id))
      .filter((n): n is string => Boolean(n));
    const prereqsReady =
      prereqIds.length > 0 && prereqIds.every((id) => (decayed.get(id) ?? 0) >= MASTERED);
    const dependents = edges
      .filter((e) => e.from_node_id === next.id)
      .map((e) => nameOf(e.to_node_id))
      .filter((n): n is string => Boolean(n));
    const base =
      prereqNames.length === 0
        ? "It's a foundation skill, so you can start right away."
        : prereqsReady
          ? `Its prerequisites (${prereqNames.join(", ")}) are in good shape.`
          : `It builds on ${prereqNames.join(", ")}.`;
    const unlocks = dependents.length
      ? dependents.length === 1
        ? ` Finishing it unlocks ${dependents[0]}.`
        : ` Finishing it moves you toward ${dependents[0]} and more.`
      : "";
    nextStep = { name: next.name, why: base + unlocks };
  }

  const daysLeft = profile?.deadline_date
    ? Math.ceil(
        (new Date(`${profile.deadline_date}T00:00:00Z`).getTime() - Date.now()) / 86_400_000,
      )
    : null;

  const goalText = profile?.goal_text ?? null;
  const goalName = goalNode?.name ?? null;
  const domainLabel =
    domain === DOMAIN ? "Java Backend" : (goalText ?? goalName ?? "Custom goal");
  const learningStyle = profile?.learning_style
    ? (LEARNING_STYLE_LABELS.get(profile.learning_style) ?? profile.learning_style)
    : null;
  const hasAnyAssessment = states.some((s) => Number(s.observation_count) > 0);

  /* ---------------- Plain-language prompt summary --------------------- */
  // This block is the ONLY learner context the model ever receives. It is
  // intentionally plain language — no internal scores or system names.
  const lines: string[] = [];
  if (profile?.display_name) lines.push(`The learner's name is ${profile.display_name}.`);
  if (goalText || goalName) {
    lines.push(
      goalText && goalName
        ? `Their goal: "${goalText}" (target skill on the map: "${goalName}").`
        : `Their goal: "${goalText ?? goalName}".`,
    );
  } else {
    lines.push("They have not set a goal yet.");
  }
  if (nextStep) lines.push(`Recommended next step: "${nextStep.name}" — ${nextStep.why}`);
  if (strong.length) lines.push(`Solid grasp: ${strong.slice(0, 8).join(", ")}.`);
  const developing = inProgress.filter((s) => s.status === "Building confidence");
  const starting = inProgress.filter((s) => s.status === "Just starting");
  if (developing.length)
    lines.push(`Building confidence: ${developing.map((s) => s.name).slice(0, 8).join(", ")}.`);
  if (starting.length)
    lines.push(`Just starting: ${starting.map((s) => s.name).slice(0, 8).join(", ")}.`);
  if (unstarted.length)
    lines.push(`Not started yet: ${unstarted.slice(0, 8).join(", ")}.`);
  if (fading.length)
    lines.push(`Previously solid but fading — worth reviewing: ${fading.slice(0, 6).join(", ")}.`);
  const hiddenGapNames = [...hiddenGapIds]
    .map((id) => nameOf(id))
    .filter((n): n is string => Boolean(n))
    .slice(0, 6);
  if (hiddenGapNames.length)
    lines.push(`Hidden prerequisite gaps (never properly assessed): ${hiddenGapNames.join(", ")}.`);
  if (activeBridges.length)
    lines.push(`Active catch-up (bridge) modules: ${activeBridges.slice(0, 4).join(", ")}.`);
  if (upcoming.length)
    lines.push(
      `Upcoming on their plan: ${upcoming
        .map((p) => `${p.name} (~${p.minutes} min)`)
        .join(" → ")}.`,
    );
  const constraintBits: string[] = [];
  if (profile?.daily_time_minutes)
    constraintBits.push(`about ${profile.daily_time_minutes} minutes per day`);
  if (daysLeft !== null) constraintBits.push(daysLeft >= 0 ? `${daysLeft} days left` : "past their deadline");
  if (learningStyle) constraintBits.push(`prefers ${learningStyle.toLowerCase()}`);
  if (constraintBits.length) lines.push(`Constraints: ${constraintBits.join("; ")}.`);
  if (!hasAnyAssessment)
    lines.push("They have not completed any calibration yet — treat their skill levels as unknown.");

  const base: TutorLearnerContext = {
    displayName: profile?.display_name ?? null,
    goalText,
    goalName,
    domainLabel,
    nextStep,
    inProgress: inProgress.slice(0, 6),
    strong: strong.slice(0, 8),
    unstarted: unstarted.slice(0, 10),
    fading: fading.slice(0, 6),
    hiddenGaps: hiddenGapNames,
    activeBridges: activeBridges.slice(0, 4),
    upcoming,
    dailyMinutes: profile?.daily_time_minutes ?? null,
    daysLeft,
    learningStyle,
    hasAnyAssessment,
    promptSummary: lines.join("\n"),
  };

  // Interview extension — computed ONLY for the AI Interview portal. The
  // Tutor path returns `base` untouched, byte-for-byte as before.
  if (!opts?.interview) return base;

  const weakestVerified = scoped.nodes
    .map((n) => ({ name: n.name, st: stateByNode.get(n.id) }))
    .filter(
      (x): x is { name: string; st: StateRow } =>
        Boolean(x.st) && Number(x.st!.observation_count) >= INTERVIEW_VERIFIED_MIN_OBSERVATIONS,
    )
    .map((x) => ({ name: x.name, d: decayed.get(scopedIdByName(scoped.nodes, x.name)) ?? 0 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 4)
    .map((x) => x.name);

  const targetRole =
    goalText ?? goalName ?? (domain === DOMAIN ? "Java Backend Developer" : domainLabel);

  const iLines: string[] = [];
  iLines.push(`Target role/domain for this interview: ${targetRole}.`);
  if (nextStep) iLines.push(`Their current recommended focus: "${nextStep.name}".`);
  if (weakestVerified.length)
    iLines.push(
      `Verified weak spots (properly assessed, currently their weakest): ${weakestVerified.join(", ")}.`,
    );
  if (hiddenGapNames.length)
    iLines.push(`Hidden prerequisite gaps (never properly assessed): ${hiddenGapNames.join(", ")}.`);
  if (strong.length) iLines.push(`Strengths to build on: ${strong.slice(0, 5).join(", ")}.`);
  if (!hasAnyAssessment)
    iLines.push("No verified skill data yet — keep questions foundational and role-appropriate.");

  return {
    ...base,
    interview: {
      targetRole,
      weakestVerified,
      hiddenGaps: hiddenGapNames,
      recommendedFocus: nextStep?.name ?? null,
      promptSummary: iLines.join("\n"),
    },
  };
}

/** Node id lookup by name within a node list (interview extension helper). */
function scopedIdByName(nodes: SkillNode[], name: string): string {
  return nodes.find((n) => n.name === name)?.id ?? "";
}

/* ---------------------------------------------------------------------- */
/* Prompt + gateway call                                                   */
/* ---------------------------------------------------------------------- */

export const TUTOR_SYSTEM_PROMPT = `You are PathMind's AI Tutor — a warm, precise learning companion inside an adaptive learning platform.

You receive a snapshot of the learner's real current state (goal, skills, plan) below. Use it to personalise every answer. Never invent progress, skill levels, deadlines or recommendations that are not in the snapshot; if the snapshot doesn't cover something, say so plainly.

How to teach:
- Teach like a great tutor: short explanations, concrete examples, analogies, hints before answers.
- When asked to quiz or practice, ask ONE question at a time and wait for the learner's answer before continuing.
- When the learner struggles, simplify and encourage; when they are solid, go deeper.
- Connect topics back to their goal and to the prerequisites in the snapshot.
- Prefer topics from their current path when suggesting what to study.

Hard rules:
- Never mention internal scores, probabilities, algorithms, IDs, databases or system internals. Translate everything into plain learner language (e.g. "you're still building confidence with SQL joins").
- You cannot change the learner's plan, mark skills complete, or update their progress — if asked, explain that happens through practice and calibration in the app.
- Keep answers focused: a few short paragraphs or a compact list. Use markdown.`;

export function buildTutorMessages(
  context: TutorLearnerContext,
  history: { role: "user" | "assistant"; content: string }[],
): { role: "system" | "user" | "assistant"; content: string }[] {
  return [
    {
      role: "system",
      content: `${TUTOR_SYSTEM_PROMPT}\n\nLEARNER SNAPSHOT (their real PathMind state right now):\n${context.promptSummary}`,
    },
    ...history,
  ];
}

/**
 * Single, non-streamed tutor completion. Replies are short (capped), so a
 * buffered call is appropriate here — the same pattern as the app's other
 * AI features. Errors are mapped to friendly learner-facing messages; only
 * transient statuses (429/5xx) are phrased as retryable.
 */
async function callTutorModel(
  apiKey: string,
  messages: {
    role: "system" | "user" | "assistant";
    content: string;
  }[],
): Promise<string> {
  console.log("[TUTOR 1] callTutorModel entered");
  console.log("[TUTOR 2] message count:", messages.length);

  const systemMessage = messages.find((m) => m.role === "system");

  const conversationMessages = messages.filter(
    (m) => m.role !== "system",
  );

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    console.error("[TUTOR TIMEOUT] Gemini request exceeded 30 seconds");
    controller.abort();
  }, 30_000);

  try {
    console.log("[TUTOR 3] Starting Gemini request");

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent",
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
                parts: [
                  {
                    text: systemMessage.content,
                  },
                ],
              }
            : undefined,

          contents: conversationMessages.map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [
              {
                text: message.content,
              },
            ],
          })),

          generationConfig: {
            maxOutputTokens: 1200,

            thinkingConfig: {
              thinkingLevel: "low",
            },
          },
        }),
      },
    );

    console.log("[TUTOR 4] Gemini HTTP status:", response.status);

    const rawResponse = await response.text();

    console.log(
      "[TUTOR 5] Gemini response received:",
      rawResponse.slice(0, 3000),
    );

    if (!response.ok) {
      throw new Error(
        `Gemini API returned HTTP ${response.status}: ${rawResponse.slice(
          0,
          1000,
        )}`,
      );
    }

    let payload: {
      candidates?: {
        content?: {
          parts?: {
            text?: string;
          }[];
        };
        finishReason?: string;
      }[];
    };

    try {
      payload = JSON.parse(rawResponse);
    } catch {
      throw new Error("Gemini returned invalid JSON.");
    }

    console.log(
      "[TUTOR 6] Candidate count:",
      payload.candidates?.length ?? 0,
    );

    const text =
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim() ?? "";

    console.log("[TUTOR 7] Extracted response length:", text.length);

    if (!text) {
      console.error(
        "[TUTOR 8] Gemini returned no text:",
        JSON.stringify(payload, null, 2),
      );

      throw new Error("Gemini returned no text.");
    }

    return text;
  } catch (error) {
    console.error("[TUTOR ERROR]", error);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "The tutor took too long to respond. Please try again.",
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/* ---------------------------------------------------------------------- */
/* Server-function implementations                                         */
/* ---------------------------------------------------------------------- */

export async function listConversationsImpl(
  supabase: Db,
  userId: string,
): Promise<TutorConversationSummary[]> {
  const { data: convos, error } = await supabase
    .from("tutor_conversations")
    .select("id, created_at, last_message_at")
    .eq("user_id", userId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error("We couldn't load your conversations.");
  if (!convos?.length) return [];

  const ids = convos.map((c) => c.id);
  const { data: firsts } = await supabase
    .from("tutor_messages")
    .select("conversation_id, content")
    .in("conversation_id", ids)
    .eq("role", "user")
    .order("created_at", { ascending: true })
    .limit(500);
  const previewBy = new Map<string, string>();
  for (const m of firsts ?? []) {
    if (!previewBy.has(m.conversation_id)) {
      previewBy.set(m.conversation_id, m.content.slice(0, 90));
    }
  }
  return convos.map((c) => ({ ...c, preview: previewBy.get(c.id) ?? null }));
}

export async function getMessagesImpl(
  supabase: Db,
  userId: string,
  conversationId: string,
): Promise<TutorMessage[]> {
  const { data: convo } = await supabase
    .from("tutor_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!convo) throw new Error("That conversation could not be found.");

  const { data, error } = await supabase
    .from("tutor_messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error("We couldn't load the conversation.");
  return (data ?? []) as TutorMessage[];
}

export async function createConversationImpl(
  supabase: Db,
  userId: string,
): Promise<TutorConversationSummary> {
  const { data, error } = await supabase
    .from("tutor_conversations")
    .insert({ user_id: userId })
    .select("id, created_at, last_message_at")
    .single();
  if (error || !data) throw new Error("We couldn't start a conversation — please try again.");
  return { ...data, preview: null };
}

export async function deleteConversationImpl(
  supabase: Db,
  userId: string,
  conversationId: string,
): Promise<{ ok: true }> {
  const { error } = await supabase
    .from("tutor_conversations")
    .delete()
    .eq("id", conversationId)
    .eq("user_id", userId);
  if (error) throw new Error("We couldn't delete that conversation.");
  return { ok: true };
}

export async function sendMessageImpl(
  supabase: Db,
  userId: string,
  conversationId: string,
  rawText: string,
): Promise<{ message: TutorMessage; duplicated: boolean }> {
  const text = rawText.trim();
  if (!text) throw new Error("Type a message first.");
  // Hard learner-message limit — enforced BEFORE any AI call.
  if (text.length > TUTOR_MESSAGE_MAX) {
    throw new Error(
      `That message is a little long. Try shortening it to ${TUTOR_MESSAGE_MAX.toLocaleString()} characters.`,
    );
  }

  // Ownership verification (RLS also enforces this; we fail with a friendly error).
  const { data: convo, error: convoError } = await supabase
    .from("tutor_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (convoError) throw new Error("We couldn't open that conversation.");
  if (!convo) throw new Error("That conversation could not be found.");

  // Lightweight duplicate guard — protects against double submit and network
  // retry without any extra infrastructure. It looks at the latest exchange.
  const { data: tail } = await supabase
    .from("tutor_messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(2);
  const last = tail?.[0] ?? null;
  const prev = tail?.[1] ?? null;
  const isRecent = (iso: string) => Date.now() - new Date(iso).getTime() < DUPLICATE_WINDOW_MS;

  // Identical message already answered moments ago → return the existing
  // reply instead of asking the AI again (retry / double-click after success).
  if (
    last?.role === "assistant" &&
    prev?.role === "user" &&
    prev.content === text &&
    isRecent(prev.created_at)
  ) {
    return { message: last as TutorMessage, duplicated: true };
  }

  // Identical message persisted but never answered (AI failed last time) →
  // answer the existing row instead of inserting a duplicate.
  const reuseExisting = last?.role === "user" && last.content === text && isRecent(last.created_at);
  if (!reuseExisting) {
    const { error: insertError } = await supabase
      .from("tutor_messages")
      .insert({ conversation_id: conversationId, role: "user", content: text });
    if (insertError) throw new Error("We couldn't save your message — please try again.");
  }

  // AI history cap: ONLY the latest 20 messages (≈10 exchanges) are sent to
  // the model. Older messages stay persisted and visible in the UI.
  const { data: historyRows, error: historyError } = await supabase
    .from("tutor_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(AI_HISTORY_LIMIT);
  if (historyError) throw new Error("We couldn't load the conversation.");
  const history = (historyRows ?? []).reverse().map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content,
  }));

  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("The tutor isn't configured yet.");

  // Shared context assembly — the single source of Tutor learner context.
  const context = await assembleTutorLearnerContext(supabase, userId);
  const reply = await callTutorModel(apiKey, buildTutorMessages(context, history),1200,);

  const { data: saved, error: saveError } = await supabase
    .from("tutor_messages")
    .insert({ conversation_id: conversationId, role: "assistant", content: reply })
    .select("id, role, content, created_at")
    .single();
  if (saveError || !saved) throw new Error("We couldn't save the reply — please try again.");
  await supabase
    .from("tutor_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);
  return { message: saved as TutorMessage, duplicated: false };
}
