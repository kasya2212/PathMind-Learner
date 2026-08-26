import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { findCapstoneId } from "@/lib/graph";
import {
  GENERATED_DOMAIN_PREFIX,
  generateDomainSpec,
  insertDomainGraph,
  slugifyGoal,
  type DomainNodeRow,
} from "@/lib/domains.server";

export type GeneratedDomain = {
  domain: string;
  created: boolean;
  capstone_node_id: string;
  nodes: DomainNodeRow[];
};

/**
 * Resolves a free-text goal to a real skill graph. If the goal's domain slug
 * already exists (another learner — or an earlier attempt — generated it),
 * the shared template is reused; otherwise a new graph + diagnostic bank is
 * generated with AI and inserted into the existing skill_nodes / skill_edges
 * / diagnostic_items tables. The caller always gets back the capstone node
 * to store as goal_node_id — everything downstream (calibration, replan,
 * gaps, plan) already works off that id.
 */
export const generateCustomDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { goal_text: string }) => {
    const goal = String(input?.goal_text ?? "").trim();
    if (goal.length < 3) throw new Error("Tell us a little more about your goal.");
    if (goal.length > 200) throw new Error("Keep the goal under 200 characters.");
    return { goal_text: goal };
  })
  .handler(async ({ data, context }): Promise<GeneratedDomain> => {
    const { supabase } = context;
    const domain = slugifyGoal(data.goal_text);

    // Reuse path: a domain with this slug already has a full graph.
    const { data: existing, error: existingError } = await supabase
      .from("skill_nodes")
      .select("id, name, is_required")
      .eq("domain", domain);
    if (existingError) throw new Error(existingError.message);

    if ((existing ?? []).length >= 8) {
      const ids = new Set((existing ?? []).map((n) => n.id));
      const { data: edgeRows } = await supabase.from("skill_edges").select("*");
      const edges = (edgeRows ?? []).filter(
        (e) => ids.has(e.from_node_id) && ids.has(e.to_node_id),
      );
      const capstone = findCapstoneId(existing ?? [], edges);
      if (!capstone) throw new Error("That skill map is incomplete — please try again.");
      return {
        domain,
        created: false,
        capstone_node_id: capstone,
        nodes: (existing ?? []).map((n) => ({ id: n.id, name: n.name })),
      };
    }

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this project.");

    const spec = await generateDomainSpec(data.goal_text, apiKey);

    let nodes: DomainNodeRow[];
    try {
      nodes = await insertDomainGraph(domain, spec);
    } catch (error) {
      // Concurrent generation of the same goal: reuse whoever won the race.
      const { data: retry } = await supabase
        .from("skill_nodes")
        .select("id, name, is_required")
        .eq("domain", domain);
      if ((retry ?? []).length >= 8) {
        const ids = new Set((retry ?? []).map((n) => n.id));
        const { data: edgeRows } = await supabase.from("skill_edges").select("*");
        const capstone = findCapstoneId(
          retry ?? [],
          (edgeRows ?? []).filter((e) => ids.has(e.from_node_id) && ids.has(e.to_node_id)),
        );
        if (capstone) {
          return {
            domain,
            created: false,
            capstone_node_id: capstone,
            nodes: (retry ?? []).map((n) => ({ id: n.id, name: n.name })),
          };
        }
      }
      throw error;
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const { data: edgeRows } = await supabase.from("skill_edges").select("*");
    const capstone = findCapstoneId(
      nodes.map((n) => ({ id: n.id, name: n.name, is_required: true })),
      (edgeRows ?? []).filter((e) => nodeIds.has(e.from_node_id) && nodeIds.has(e.to_node_id)),
    );
    if (!capstone) throw new Error("Could not finish the generated skill map — please try again.");

    return { domain, created: true, capstone_node_id: capstone, nodes };
  });

export { GENERATED_DOMAIN_PREFIX };
