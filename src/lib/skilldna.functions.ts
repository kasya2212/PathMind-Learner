import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { bktUpdate, decayMastery, DEFAULT_MASTERY } from "@/lib/bkt";
import { courseMatchesNode } from "@/lib/matching";
import { HARD_PREREQ_WEIGHT } from "@/lib/replan";

/**
 * Skill DNA engine.
 *
 * All functions run server-side and derive `user_id` from the validated
 * session (`context.userId`) — a client-supplied user id is never trusted.
 *
 * Roadmap snapshots are NOT written here: `replan()` is the single roadmap
 * writer. Hidden-gap detection writes at most one history row per actual
 * change in the hidden-gap set, so repeated dashboard loads stay silent.
 */

export const updateMastery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      skill_node_id: string;
      correct: boolean;
      item_id?: string | null;
      session_id?: string | null;
      selected_option_id?: string | null;
      difficulty?: number | null;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: existing, error: readError } = await supabase
      .from("learner_skill_state")
      .select("p_mastery, observation_count")
      .eq("user_id", userId)
      .eq("skill_node_id", data.skill_node_id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);

    const previous = existing ? Number(existing.p_mastery) : DEFAULT_MASTERY;
    const observations = existing ? Number(existing.observation_count) : 0;

    const result = bktUpdate(previous, data.correct);
    const now = new Date().toISOString();

    const { error: upsertError } = await supabase.from("learner_skill_state").upsert(
      {
        user_id: userId,
        skill_node_id: data.skill_node_id,
        p_mastery: result.new_mastery,
        observation_count: observations + 1,
        // Real BKT evidence: a diagnostic answer (session-scoped) or a
        // self-marked task. Overwrites any prior 'self_reported' marker —
        // measured evidence always supersedes a claim.
        source: data.session_id ? "diagnostic" : "task",
        last_practiced_at: now,
      },
      { onConflict: "user_id,skill_node_id" },
    );
    if (upsertError) throw new Error(upsertError.message);

    const { error: responseError } = await supabase.from("learner_responses").insert({
      user_id: userId,
      skill_node_id: data.skill_node_id,
      item_id: data.item_id ?? null,
      session_id: data.session_id ?? null,
      selected_option_id: data.selected_option_id ?? null,
      difficulty: data.difficulty ?? null,
      correct: data.correct,
      attempt: observations + 1,
      previous_mastery: result.previous_mastery,
      new_mastery: result.new_mastery,
    });
    if (responseError) throw new Error(responseError.message);

    return {
      skill_node_id: data.skill_node_id,
      previous_mastery: result.previous_mastery,
      posterior_mastery: result.posterior_mastery,
      new_mastery: result.new_mastery,
      observation_count: observations + 1,
    };
  });

export const getDecayedMastery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { skill_node_id: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("learner_skill_state")
      .select("p_mastery, observation_count, last_practiced_at")
      .eq("user_id", userId)
      .eq("skill_node_id", data.skill_node_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return { skill_node_id: data.skill_node_id, p_mastery: 0, decayed_mastery: 0 };

    return {
      skill_node_id: data.skill_node_id,
      p_mastery: Number(row.p_mastery),
      decayed_mastery: decayMastery({
        p_mastery: Number(row.p_mastery),
        observation_count: Number(row.observation_count),
        last_practiced_at: row.last_practiced_at,
      }),
    };
  });

export type HiddenGap = {
  id: string;
  name: string;
  description: string | null;
  effort_hours: number;
  /**
   * True when the learner CLAIMED coverage of this skill (a listed course
   * title matched it, or a self-reported credit row exists) but there is no
   * real BKT observation yet. Claimed coverage lowers confidence in the gap
   * — it does NOT eliminate it: the item is still flagged, marked
   * provisional, and ranked below never-claimed gaps.
   */
  provisional: boolean;
  reason: string;
};

/** Hidden-gap rows store their own payload — never a roadmap snapshot. */
type GapSnapshot = { gap_ids?: string[] };

export const detectHiddenGaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { goal_node_id: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const [nodesRes, edgesRes, stateRes, constraintsRes, lastGapRes] = await Promise.all([
      supabase.from("skill_nodes").select("id, name, domain, description, effort_hours"),
      supabase.from("skill_edges").select("from_node_id, to_node_id, weight"),
      supabase
        .from("learner_skill_state")
        .select("skill_node_id, observation_count, source")
        .eq("user_id", userId),
      supabase
        .from("learner_constraints")
        .select("completed_courses")
        .eq("user_id", userId)
        .maybeSingle(),
      // Recent rows, not just the newest: legacy single-gap rows used the
      // shape {goal_node_id, node_id} and carry no gap_ids array — they are
      // skipped on read, never mistaken for the current gap set.
      supabase
        .from("plan_history")
        .select("node_snapshot")
        .eq("user_id", userId)
        .eq("trigger", "hidden_gap_detected")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    if (nodesRes.error) throw new Error(nodesRes.error.message);
    if (edgesRes.error) throw new Error(edgesRes.error.message);
    if (stateRes.error) throw new Error(stateRes.error.message);

    const nodes = nodesRes.data ?? [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const goal = byId.get(data.goal_node_id);
    if (!goal) return { goal_node_id: data.goal_node_id, goal_name: null, hidden: [] as HiddenGap[] };

    // Scope to the goal's own domain — seeded template and AI-generated
    // custom domains share these tables and must never mix.
    const domainIds = new Set(
      nodes.filter((n) => n.domain === goal.domain).map((n) => n.id),
    );

    // Backward closure over hard prerequisites (single shared threshold).
    const hardEdges = (edgesRes.data ?? []).filter(
      (e) =>
        Number(e.weight) >= HARD_PREREQ_WEIGHT &&
        domainIds.has(e.from_node_id) &&
        domainIds.has(e.to_node_id),
    );
    const closure = new Set<string>();
    const queue = [data.goal_node_id];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of hardEdges) {
        if (edge.to_node_id !== current) continue;
        if (closure.has(edge.from_node_id)) continue;
        closure.add(edge.from_node_id);
        queue.push(edge.from_node_id);
      }
    }

    // Evidence tiers, in ascending strength:
    //  - claimed: self-reported coverage only — a learner_skill_state row
    //    written by applyCompletedCourseCredit (source='self_reported', zero
    //    observations). Claims REDUCE confidence in a gap, never eliminate it.
    //  - observed: real BKT evidence. updateMastery is the only writer of
    //    observation_count > 0 rows, and it sets source to diagnostic/task —
    //    a skill with any such row has been genuinely measured and is never
    //    a hidden gap.
    const observed = new Set<string>();
    const claimed = new Set<string>();
    for (const r of stateRes.data ?? []) {
      if (Number(r.observation_count) > 0) observed.add(r.skill_node_id);
      if (r.source === "self_reported") claimed.add(r.skill_node_id);
    }
    const completedCourses = constraintsRes.data?.completed_courses ?? [];

    const hidden: HiddenGap[] = [];
    for (const nodeId of closure) {
      const node = byId.get(nodeId);
      if (!node) continue;
      if (observed.has(nodeId)) continue;
      const matchedCourse = completedCourses.find((course) => courseMatchesNode(course, node.name));
      const provisional = claimed.has(nodeId) || Boolean(matchedCourse);

      hidden.push({
        id: node.id,
        name: node.name,
        description: node.description,
        effort_hours: Number(node.effort_hours),
        provisional,
        reason: provisional
          ? `${node.name} is a hard prerequisite of ${goal.name}. You listed ${matchedCourse ? `"${matchedCourse}"` : "coursework"} as completed, so this is probably familiar — but it has never been tested, so it stays flagged until calibration confirms it.`
          : `${node.name} is a hard prerequisite of ${goal.name}, but you have never been assessed on it and none of your completed courses cover it.`,
      });
    }
    // Never-claimed gaps first (highest confidence), provisional after.
    hidden.sort((a, b) => Number(a.provisional) - Number(b.provisional));

    // Semantic dedupe: write history only when the hidden SET actually changed
    // since the last detection row — one row per change, never per gap. The
    // read-back scans recent rows and skips legacy single-gap payloads.
    const gapIds = hidden.map((g) => g.id).sort();
    const previousIds = (() => {
      for (const row of lastGapRes.data ?? []) {
        const snap = row.node_snapshot as GapSnapshot | null;
        if (snap && Array.isArray(snap.gap_ids)) return [...snap.gap_ids].sort();
      }
      return [] as string[];
    })();
    const changed = gapIds.join("|") !== previousIds.join("|");

    if (changed) {
      if (gapIds.length > 0) {
        await supabase.from("plan_history").insert({
          user_id: userId,
          trigger: "hidden_gap_detected",
          summary: `Hidden prerequisite${hidden.length === 1 ? "" : "s"} detected: ${hidden
            .map((g) => g.name)
            .join(", ")}`,
          reasoning: `${hidden
            .map((g) => g.reason)
            .join(" ")} Supporting goal: ${goal.name}. They stayed hidden because they never appeared in your calibration answers or your completed-course list.`,
          node_snapshot: { gap_ids: gapIds } as never,
        });
      } else if (previousIds.length > 0) {
        await supabase.from("plan_history").insert({
          user_id: userId,
          trigger: "hidden_gap_detected",
          summary: "All hidden prerequisites cleared",
          reasoning: `Every hard prerequisite of ${goal.name} is now either assessed or covered by a completed course.`,
          node_snapshot: { gap_ids: [] } as never,
        });
      }
    }

    return { goal_node_id: goal.id, goal_name: goal.name, hidden };
  });

export const generateBridgeModule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { skill_node_id: string; goal_node_id: string | null }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: node, error: nodeError } = await supabase
      .from("skill_nodes")
      .select("id, name, description")
      .eq("id", data.skill_node_id)
      .maybeSingle();
    if (nodeError) throw new Error(nodeError.message);
    if (!node) throw new Error("Skill not found");

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this project.");

    const prompt = `Generate a short, focused 7-10 day learning bridge covering ONLY the topic '${node.name}: ${node.description ?? ""}'.

Do not include unrelated topics.

Output as a numbered list of 5-8 concrete daily tasks, each 1-2 sentences.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are a curriculum designer. Answer with the numbered list only, no preamble.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) throw new Error("AI is busy right now — try again in a moment.");
      if (response.status === 402) throw new Error("AI credits are exhausted for this project.");
      throw new Error("Could not generate the bridge module.");
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = payload.choices?.[0]?.message?.content ?? "";

    const tasks = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\d+[.)]/.test(line))
      .map((line) => line.replace(/^\d+[.)]\s*/, ""))
      .filter(Boolean);

    if (tasks.length === 0) throw new Error("Could not generate the bridge module.");

    const title = `${node.name} bridge`;
    const { data: saved, error: saveError } = await supabase
      .from("bridge_modules")
      .insert({
        user_id: userId,
        skill_node_id: node.id,
        goal_node_id: data.goal_node_id,
        title,
        tasks: tasks as never,
      })
      .select("id, title, tasks, created_at, skill_node_id, goal_node_id, status")
      .single();
    if (saveError) throw new Error(saveError.message);

    return { ...saved, node_name: node.name, tasks };
  });

/**
 * Bridge completion lifecycle: a learner marks a generated bridge done, and
 * every downstream consumer (replan budget, gap surfaces) reflects it via
 * `bridge_modules.status` — resolved statuses drop out of future plans.
 */
export const completeBridgeModule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bridge_id: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: bridge, error: readError } = await supabase
      .from("bridge_modules")
      .select("id, status")
      .eq("id", data.bridge_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!bridge) throw new Error("Bridge module not found.");
    if (bridge.status === "complete") return { id: bridge.id, status: "complete" as const };

    const { error: updateError } = await supabase
      .from("bridge_modules")
      .update({ status: "complete" })
      .eq("id", data.bridge_id)
      .eq("user_id", userId);
    if (updateError) throw new Error(updateError.message);

    return { id: bridge.id, status: "complete" as const };
  });

/**
 * Records completed-course credit server-side as SELF-REPORTED evidence.
 *
 * This is deliberately NOT a mastery update:
 *  - no learner_responses rows (nothing was answered),
 *  - observation_count stays at the schema default 0 (no BKT observation is
 *    fabricated),
 *  - p_mastery is left to the schema default (the same prior every untested
 *    skill starts at) — application logic assigns no mastery value here,
 *  - the row is marked source='self_reported' so every consumer can tell a
 *    claim apart from real diagnostic/task evidence.
 *
 * Skills that already have learner state are never touched — measured
 * evidence always wins over a claim. One auditable plan_history row records
 * exactly which skills were credited, from which courses.
 */
export const applyCompletedCourseCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { node_names: string[]; courses: string[] }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const wanted = [...new Set(data.node_names)];
    if (wanted.length === 0) return { credited: [] as string[] };

    const { data: nodeRows, error: nodeError } = await supabase
      .from("skill_nodes")
      .select("id, name")
      .in("name", wanted);
    if (nodeError) throw new Error(nodeError.message);
    const targets = nodeRows ?? [];
    if (targets.length === 0) return { credited: [] as string[] };

    const { data: existing, error: stateError } = await supabase
      .from("learner_skill_state")
      .select("skill_node_id")
      .eq("user_id", userId)
      .in(
        "skill_node_id",
        targets.map((n) => n.id),
      );
    if (stateError) throw new Error(stateError.message);

    // Measured evidence always wins: never touch a skill with existing state.
    const alreadyKnown = new Set((existing ?? []).map((r) => r.skill_node_id));
    const fresh = targets.filter((n) => !alreadyKnown.has(n.id));
    if (fresh.length === 0) return { credited: [] as string[] };

    const { error: insertError } = await supabase.from("learner_skill_state").insert(
      fresh.map((n) => ({
        user_id: userId,
        skill_node_id: n.id,
        // Default mastery, zero observations — a claim, not a measurement.
        source: "self_reported",
        last_practiced_at: null,
      })),
    );
    if (insertError) throw new Error(insertError.message);

    await supabase.from("plan_history").insert({
      user_id: userId,
      trigger: "course_credit_applied",
      summary: `Course credit applied: ${fresh.map((n) => n.name).join(", ")}`,
      reasoning: `Marked as self-reported from your completed courses (${data.courses.join(", ")}). Not a tested result — calibration will verify ${
        fresh.length === 1 ? "this skill" : "these skills"
      }.`,
      node_snapshot: null,
    });

    return { credited: fresh.map((n) => n.name) };
  });

/**
 * Exposure signal — bridge-module scope ONLY.
 *
 * The Bridge Module screen is the only surface where a learner views
 * instructional material, so exposure is recorded only for those nodes.
 * Opening the screen stamps `last_exposed_at` and NOTHING else:
 *  - no learner_responses row (nothing was answered),
 *  - observation_count and p_mastery untouched (no BKT observation is
 *    fabricated — opening a screen proves the screen was opened, never
 *    that the material was studied or learned),
 *  - newly created rows use source='exposure' so no consumer can mistake
 *    them for measured evidence (diagnostic/task) or a self-reported claim;
 *    detectHiddenGaps only treats observation_count > 0 as observed and
 *    source='self_reported' as claimed, so this changes no gap logic.
 */
export const recordExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { skill_node_id: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const now = new Date().toISOString();

    const { data: existing, error: readError } = await supabase
      .from("learner_skill_state")
      .select("skill_node_id")
      .eq("user_id", userId)
      .eq("skill_node_id", data.skill_node_id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);

    if (existing) {
      const { error } = await supabase
        .from("learner_skill_state")
        .update({ last_exposed_at: now })
        .eq("user_id", userId)
        .eq("skill_node_id", data.skill_node_id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("learner_skill_state").insert({
        user_id: userId,
        skill_node_id: data.skill_node_id,
        // Default mastery, zero observations — exposure is not evidence.
        source: "exposure",
        last_practiced_at: null,
        last_exposed_at: now,
      });
      if (error) throw new Error(error.message);
    }

    return { skill_node_id: data.skill_node_id, last_exposed_at: now };
  });
