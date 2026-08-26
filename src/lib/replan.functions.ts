import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decayMastery } from "@/lib/bkt";
import {
  PLAN_SNAPSHOT_TRIGGERS,
  firstValidPlanRow,
  uniqueInOrder,
  validPlanNodeIds,
} from "@/lib/planHistory";
import {
  EFFECTIVELY_MASTERED,
  bridgeEffortHours,
  daysBetween,
  describeDiff,
  diffPlans,
  hardPrerequisiteClosure,
  suggestedDeadline,
  topoSortClosure,
  type PlanItem,
  type ReplanNode,
} from "@/lib/replan";

const RESOLVED_BRIDGE_STATUSES = new Set(["complete", "completed", "resolved", "done"]);

/**
 * replan() — recomputes the learner's roadmap from their current constraints,
 * decayed mastery and outstanding bridge modules, then archives it to
 * plan_history. The user is always taken from the validated session.
 *
 * Data-integrity contract:
 *  - Roadmap snapshots are archived through the `record_plan_snapshot` RPC,
 *    which holds a per-learner advisory lock and refuses to insert when the
 *    ordered skill list is unchanged — replan is idempotent and race-safe.
 *  - The canonical snapshot shape is `{ nodes: [<skill node ids>] }` — unique
 *    skill IDs in topo order, no display names, no parallel arrays.
 *  - Only PLAN_SNAPSHOT_TRIGGERS rows are read as "the previous plan".
 */
export const replan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const now = new Date();

    const { data: constraints, error: constraintsError } = await supabase
      .from("learner_constraints")
      .select("goal_node_id, daily_time_minutes, deadline_date")
      .eq("user_id", userId)
      .maybeSingle();
    if (constraintsError) throw new Error(constraintsError.message);

    if (!constraints?.goal_node_id) {
      return { valid: false as const, reason: "goal_needed" };
    }

    const dailyMinutes = Number(constraints.daily_time_minutes ?? 0);
    if (!Number.isFinite(dailyMinutes) || dailyMinutes <= 0) {
      // No budget maths, no plan_history row.
      return { valid: false as const, reason: "daily_time_needed" };
    }

    const [nodesRes, edgesRes, stateRes, bridgeRes, historyRes] = await Promise.all([
      supabase
        .from("skill_nodes")
        .select("id, name, domain, effort_hours, is_required, market_weight"),
      supabase.from("skill_edges").select("from_node_id, to_node_id, weight"),
      supabase
        .from("learner_skill_state")
        .select("skill_node_id, p_mastery, observation_count, last_practiced_at")
        .eq("user_id", userId),
      supabase
        .from("bridge_modules")
        .select("id, title, skill_node_id, status, tasks")
        .eq("user_id", userId),
      // Only roadmap triggers count as "the previous plan" — hidden-gap,
      // calibration and course-credit rows are not plan snapshots. Recent
      // rows are scanned (not just the newest) because legacy/malformed
      // snapshots fail validation and must be skipped, not trusted.
      supabase
        .from("plan_history")
        .select("node_snapshot, created_at")
        .eq("user_id", userId)
        .in("trigger", [...PLAN_SNAPSHOT_TRIGGERS])
        .order("created_at", { ascending: false })
        .limit(25),
    ]);
    if (nodesRes.error) throw new Error(nodesRes.error.message);
    if (edgesRes.error) throw new Error(edgesRes.error.message);
    if (stateRes.error) throw new Error(stateRes.error.message);
    if (bridgeRes.error) throw new Error(bridgeRes.error.message);
    if (historyRes.error) throw new Error(historyRes.error.message);

    // Domain scoping: the plan only ever spans the goal's own graph. The
    // seeded template and AI-generated custom domains coexist in the same
    // tables — edges carry no domain, so they are filtered by node membership.
    const rawNodes = nodesRes.data ?? [];
    const goalRow = rawNodes.find((n) => n.id === constraints.goal_node_id);
    if (!goalRow) return { valid: false as const, reason: "goal_needed" };
    const domainRows = rawNodes.filter((n) => n.domain === goalRow.domain);
    const domainIds = new Set(domainRows.map((n) => n.id));

    const nodes: ReplanNode[] = domainRows.map((n) => ({
      id: n.id,
      name: n.name,
      effort_hours: Number(n.effort_hours),
      is_required: n.is_required,
      market_weight: Number(n.market_weight),
    }));
    const edges = (edgesRes.data ?? [])
      .filter((e) => domainIds.has(e.from_node_id) && domainIds.has(e.to_node_id))
      .map((e) => ({
        from_node_id: e.from_node_id,
        to_node_id: e.to_node_id,
        weight: Number(e.weight),
      }));

    const goal = nodes.find((n) => n.id === constraints.goal_node_id)!;

    // 3 — hard-prerequisite closure, topologically ordered.
    const closure = hardPrerequisiteClosure(goal.id, edges);
    const ordered = topoSortClosure(closure, nodes, edges);

    // 5 — drop anything already effectively mastered (decayed).
    const decayed = new Map<string, number>();
    for (const s of stateRes.data ?? []) {
      decayed.set(
        s.skill_node_id,
        decayMastery({
          p_mastery: Number(s.p_mastery),
          observation_count: Number(s.observation_count),
          last_practiced_at: s.last_practiced_at,
          now,
        }),
      );
    }
    let remaining = ordered.filter((n) => (decayed.get(n.id) ?? 0) < EFFECTIVELY_MASTERED);

    // 4 — bridge modules. Completion is tracked via bridge_modules.status;
    // resolved bridges drop out of the plan entirely. Effort comes from the
    // single documented formula: taskCount × BRIDGE_TASK_HOURS (replan.ts).
    const bridges = bridgeRes.data ?? [];
    const openBridges = bridges.filter((b) => !RESOLVED_BRIDGE_STATUSES.has(String(b.status)));
    const bridgeHours = new Map<string, number>();
    for (const b of openBridges) {
      const taskCount = Array.isArray(b.tasks) ? b.tasks.length : 1;
      bridgeHours.set(b.id, bridgeEffortHours(taskCount));
    }

    let items: PlanItem[] = [];
    for (const node of remaining) {
      for (const bridge of openBridges) {
        if (bridge.skill_node_id !== node.id) continue;
        items.push({
          kind: "bridge",
          id: bridge.id,
          name: bridge.title,
          effort_hours: Number((bridgeHours.get(bridge.id) ?? 0).toFixed(1)),
          is_required: true,
        });
      }
      items.push({
        kind: "skill",
        id: node.id,
        name: node.name,
        effort_hours: node.effort_hours,
        is_required: node.is_required,
      });
    }

    // 6/7/8 — budget. Bridge task time is real work, so it counts.
    let totalEffortHours =
      remaining.reduce((sum, n) => sum + n.effort_hours, 0) +
      openBridges.reduce((sum, b) => sum + (bridgeHours.get(b.id) ?? 0), 0);
    const deadline = constraints.deadline_date ?? null;
    const daysRemaining = deadline ? daysBetween(now, deadline) : null;
    const deadlineOverdue = daysRemaining !== null && daysRemaining < 0;
    const availableHours =
      daysRemaining !== null && !deadlineOverdue ? (dailyMinutes / 60) * daysRemaining : null;

    const dropped: string[] = [];
    let suggestion: { required_days: number; date: string } | null = null;

    if (deadlineOverdue) {
      suggestion = suggestedDeadline(totalEffortHours, dailyMinutes, now);
    } else if (availableHours !== null && totalEffortHours > availableHours) {
      const optional = remaining
        .filter((n) => !n.is_required)
        .sort((a, b) => a.market_weight - b.market_weight);
      for (const node of optional) {
        if (totalEffortHours <= availableHours) break;
        dropped.push(node.name);
        totalEffortHours -= node.effort_hours;
        remaining = remaining.filter((n) => n.id !== node.id);
      }
      if (totalEffortHours > availableHours) {
        // Never cut required content — suggest a realistic date instead.
        suggestion = suggestedDeadline(totalEffortHours, dailyMinutes, now);
      }
      const keptIds = new Set(remaining.map((n) => n.id));
      items = items.filter((i) => i.kind === "bridge" || keptIds.has(i.id));
    }

    const microChunking = dailyMinutes < 60;

    // 11 — diff against the most recent VALID roadmap snapshot: newest row
    // with a plan trigger whose snapshot is canonical {nodes: [uuid, ...]}.
    // Legacy/malformed rows are skipped by firstValidPlanRow, never trusted.
    // Canonical snapshot: ordered, unique skill node IDs (bridges excluded).
    const nameById = new Map(nodes.map((n) => [n.id, n.name]));
    const previousRow = firstValidPlanRow(historyRes.data ?? []);
    const previousIds = previousRow ? validPlanNodeIds(previousRow.node_snapshot) : [];
    const previousNames = previousIds.length
      ? previousIds.map((id) => nameById.get(id) ?? id)
      : null;
    const nextIds = uniqueInOrder(
      items.filter((i) => i.kind === "skill").map((i) => i.id),
    );
    const names = nextIds.map((id) => nameById.get(id) ?? id);
    const isInitial = previousIds.length === 0;
    const diff = diffPlans(previousNames, names);

    // 12 — archive, atomically. The RPC compares against the newest valid
    // snapshot under a per-learner lock and no-ops when nothing changed.
    const trigger = deadlineOverdue
      ? "deadline_overdue"
      : isInitial
        ? "initial_plan"
        : "time_budget_change";
    const summary = deadlineOverdue
      ? `Target date has passed — suggesting ${suggestion?.date}.`
      : describeDiff(diff, isInitial);
    const reasoningParts = [
      `${remaining.length} skills remain, about ${totalEffortHours.toFixed(1)} h of work.`,
      availableHours !== null
        ? `At ${dailyMinutes} min/day with ${daysRemaining} day(s) left, you have roughly ${availableHours.toFixed(
            1,
          )} h available.`
        : `No target date set, so there is no fixed budget to fit into.`,
      dropped.length ? `Dropped optional, lower market-weight skills: ${dropped.join(", ")}.` : "",
      suggestion
        ? `Suggested new target date ${suggestion.date} (${suggestion.required_days} days at the current pace).`
        : "",
      openBridges.length
        ? `${openBridges.length} active bridge module(s) included (${openBridges
            .reduce((sum, b) => sum + (bridgeHours.get(b.id) ?? 0), 0)
            .toFixed(1)} h of task time); completed bridges drop out automatically.`
        : "",
      microChunking ? "Under an hour a day — sessions will be micro-chunked." : "",
    ].filter(Boolean);

    const { data: inserted, error: insertError } = await supabase.rpc("record_plan_snapshot", {
      p_trigger: trigger,
      p_summary: summary,
      p_reasoning: reasoningParts.join(" "),
      p_node_ids: nextIds,
    });
    if (insertError) throw new Error(insertError.message);

    return {
      valid: true as const,
      changed: Boolean(inserted),
      plan: items,
      diff,
      dropped,
      summary,
      reasoning: reasoningParts.join(" "),
      total_effort_hours: Number(totalEffortHours.toFixed(1)),
      available_hours: availableHours === null ? null : Number(availableHours.toFixed(1)),
      days_remaining: daysRemaining,
      deadline_overdue: deadlineOverdue,
      suggested_new_deadline_date: suggestion?.date ?? null,
      micro_chunking: microChunking,
      bridge_completion_untracked: false,
      trigger,
    };
  });

/**
 * Newest archived plan ordering, used by the dashboard to pick the next step
 * from the plan itself rather than recomputing an unrelated recommendation.
 * Reads ONLY valid roadmap triggers; understands canonical and legacy shapes.
 */
export const getLatestPlanSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("plan_history")
      .select("created_at, trigger, summary, node_snapshot")
      .eq("user_id", userId)
      .in("trigger", [...PLAN_SNAPSHOT_TRIGGERS])
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);

    // Trigger alone is not enough: the row must also carry a VALID canonical
    // snapshot. Legacy (names-in-nodes / node_ids-parallel) and malformed
    // rows are skipped in favour of the newest row that passes validation.
    const row = firstValidPlanRow(data ?? []);
    if (!row) {
      return {
        created_at: null,
        trigger: null,
        summary: null,
        node_ids: [] as string[],
        nodes: [] as string[],
        items: [] as PlanItem[],
      };
    }

    const nodeIds = validPlanNodeIds(row.node_snapshot);
    // Resolve display names for the IDs (canonical rows no longer store them).
    const { data: nodeRows } = await supabase.from("skill_nodes").select("id, name");
    const nameById = new Map((nodeRows ?? []).map((n) => [n.id, n.name]));

    return {
      created_at: row.created_at,
      trigger: row.trigger,
      summary: row.summary,
      node_ids: nodeIds,
      nodes: nodeIds.map((id) => nameById.get(id) ?? id),
      items: [] as PlanItem[],
    };
  });
