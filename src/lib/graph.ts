import type { SkillEdge, SkillNode } from "@/lib/pathmind";

/** Every hard/soft prerequisite reachable backwards from `startIds`. */
export function ancestorClosure(
  startIds: string[],
  edges: SkillEdge[],
  minWeight = 0,
): Set<string> {
  const closure = new Set<string>();
  const queue = [...startIds];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.to_node_id !== current) continue;
      if (Number(edge.weight) < minWeight) continue;
      if (closure.has(edge.from_node_id)) continue;
      closure.add(edge.from_node_id);
      queue.push(edge.from_node_id);
    }
  }
  return closure;
}

/** Immediate skills that the given nodes unlock. */
export function directDependents(ids: Set<string>, edges: SkillEdge[]): Set<string> {
  const out = new Set<string>();
  for (const edge of edges) {
    if (ids.has(edge.from_node_id) && !ids.has(edge.to_node_id)) out.add(edge.to_node_id);
  }
  return out;
}

/**
 * The graph a learner actually sees: their goal, everything the goal genuinely
 * depends on, any subjects they explicitly picked (plus those prerequisites),
 * and the skills their goal immediately unlocks. Nothing else.
 */
export function goalSubgraph(params: {
  nodes: SkillNode[];
  edges: SkillEdge[];
  goalId: string | null;
  subjectNames?: string[];
}): { nodes: SkillNode[]; edges: SkillEdge[]; scoped: boolean } {
  const { nodes, edges, goalId, subjectNames = [] } = params;

  const byName = new Map(nodes.map((n) => [n.name, n]));
  const seeds: string[] = [];
  if (goalId && nodes.some((n) => n.id === goalId)) seeds.push(goalId);
  for (const name of subjectNames) {
    const node = byName.get(name);
    if (node) seeds.push(node.id);
  }

  if (seeds.length === 0) return { nodes, edges, scoped: false };

  const keep = new Set(seeds);
  for (const id of ancestorClosure(seeds, edges)) keep.add(id);
  for (const id of directDependents(new Set(seeds), edges)) keep.add(id);

  return {
    nodes: nodes.filter((n) => keep.has(n.id)),
    edges: edges.filter((e) => keep.has(e.from_node_id) && keep.has(e.to_node_id)),
    scoped: true,
  };
}

/** Prerequisite-respecting order (Kahn, stable by depth then effort). */
export function topoOrder(nodes: SkillNode[], edges: SkillEdge[]): SkillNode[] {
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const ids = new Set(nodes.map((n) => n.id));
  const scoped = edges.filter((e) => ids.has(e.from_node_id) && ids.has(e.to_node_id));
  for (const edge of scoped) {
    indegree.set(edge.to_node_id, (indegree.get(edge.to_node_id) ?? 0) + 1);
  }

  const ready = nodes
    .filter((n) => (indegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => Number(a.effort_hours) - Number(b.effort_hours));
  const out: SkillNode[] = [];

  while (ready.length) {
    const node = ready.shift()!;
    out.push(node);
    for (const edge of scoped) {
      if (edge.from_node_id !== node.id) continue;
      const next = (indegree.get(edge.to_node_id) ?? 0) - 1;
      indegree.set(edge.to_node_id, next);
      if (next === 0) {
        const candidate = nodes.find((n) => n.id === edge.to_node_id);
        if (candidate) ready.push(candidate);
      }
    }
    ready.sort((a, b) => Number(a.effort_hours) - Number(b.effort_hours));
  }

  // Cycles (shouldn't happen) — append leftovers so nothing disappears.
  for (const node of nodes) if (!out.includes(node)) out.push(node);
  return out;
}

/**
 * The graph's natural endpoint: a sink (no node depends on it), preferring
 * required nodes at the deepest prerequisite layer. Lets any domain — seeded
 * or AI-generated — resolve its goal/capstone node structurally, with no
 * naming convention or schema marker.
 */
export function findCapstoneId(
  nodes: { id: string; is_required?: boolean }[],
  edges: { from_node_id: string; to_node_id: string }[],
): string | null {
  if (!nodes.length) return null;
  const outDegree = new Map<string, number>();
  for (const e of edges) {
    outDegree.set(e.from_node_id, (outDegree.get(e.from_node_id) ?? 0) + 1);
  }
  const sinks = nodes.filter((n) => !outDegree.get(n.id));
  const pool = sinks.length ? sinks : nodes;

  // Depth = longest prerequisite chain beneath the node.
  const depth = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const e of edges) {
      const from = depth.get(e.from_node_id);
      const to = depth.get(e.to_node_id);
      if (from === undefined || to === undefined) continue;
      if (to < from + 1) {
        depth.set(e.to_node_id, from + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const ranked = [...pool].sort((a, b) => {
    const req = Number(b.is_required ?? false) - Number(a.is_required ?? false);
    if (req !== 0) return req;
    return (depth.get(b.id) ?? 0) - (depth.get(a.id) ?? 0);
  });
  return ranked[0]?.id ?? null;
}
