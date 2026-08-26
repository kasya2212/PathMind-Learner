import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isPlanSnapshotTrigger, snapshotNodeIds } from "@/lib/planHistory";

/**
 * Plan history for the learner, newest first. Read-only: this reads the rows
 * that replan(), hidden-gap detection, calibration and course credit write.
 *
 * Snapshot payloads are adapted on read: `node_ids` is only populated for
 * rows that carry a roadmap snapshot (valid plan triggers), in canonical ID
 * form, and `node_names` are resolved against skill_nodes.
 */
export const listPlanHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("plan_history")
      .select("id, created_at, trigger, summary, reasoning, node_snapshot")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) throw new Error(error.message);

    const rows = data ?? [];

    // Resolve skill names for canonical ID-only snapshots.
    const allIds = new Set<string>();
    for (const row of rows) {
      if (!isPlanSnapshotTrigger(row.trigger)) continue;
      for (const id of snapshotNodeIds(row.node_snapshot)) allIds.add(id);
    }
    let nameById = new Map<string, string>();
    if (allIds.size > 0) {
      const { data: nodeRows } = await supabase
        .from("skill_nodes")
        .select("id, name")
        .in("id", [...allIds]);
      nameById = new Map((nodeRows ?? []).map((n) => [n.id, n.name]));
    }

    return rows.map((row) => {
      const isPlan = isPlanSnapshotTrigger(row.trigger);
      const nodeIds = isPlan ? snapshotNodeIds(row.node_snapshot) : [];
      return {
        id: row.id,
        created_at: row.created_at,
        trigger: row.trigger,
        summary: row.summary,
        reasoning: row.reasoning,
        node_ids: nodeIds,
        node_names: nodeIds.map((id) => nameById.get(id) ?? id),
      };
    });
  });
