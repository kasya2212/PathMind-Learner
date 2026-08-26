import { MASTERED, type SkillEdge, type SkillNode } from "@/lib/pathmind";
import { topoOrder } from "@/lib/graph";

export type PlanEntry = {
  node: SkillNode;
  date: Date;
  minutes: number;
  difficulty: "Foundational" | "Intermediate" | "Advanced";
  mastery: number;
  reason: string;
  prerequisites: string[];
  prerequisitesReady: boolean;
  isHiddenGap: boolean;
  done: boolean;
};

function difficultyOf(node: SkillNode, depth: number): PlanEntry["difficulty"] {
  if (depth <= 1) return "Foundational";
  if (depth <= 3 || Number(node.effort_hours) < 14) return "Intermediate";
  return "Advanced";
}

function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Builds a prerequisite-ordered, target-date aware plan from the learner's own
 * scoped skill graph and their *decayed* mastery.
 */
export function buildTrainingPlan(params: {
  nodes: SkillNode[];
  edges: SkillEdge[];
  mastery: Map<string, number>;
  hiddenGapIds?: Set<string>;
  dailyMinutes: number;
  deadline?: string | null;
  today?: Date;
}): PlanEntry[] {
  const {
    nodes,
    edges,
    mastery,
    hiddenGapIds = new Set<string>(),
    dailyMinutes,
    deadline,
  } = params;
  if (nodes.length === 0) return [];

  const today = params.today ?? new Date();
  today.setHours(0, 0, 0, 0);

  const ordered = topoOrder(nodes, edges);
  const depth = new Map<string, number>();
  ordered.forEach((node, index) => depth.set(node.id, index === 0 ? 0 : depth.get(node.id) ?? 0));
  // depth = longest prerequisite chain length
  for (const node of ordered) {
    const parents = edges.filter((e) => e.to_node_id === node.id);
    const d = parents.length
      ? Math.max(...parents.map((p) => (depth.get(p.from_node_id) ?? 0) + 1))
      : 0;
    depth.set(node.id, d);
  }

  const remaining = ordered.filter((n) => (mastery.get(n.id) ?? 0) < MASTERED);
  if (remaining.length === 0) return [];

  // Hidden gaps jump the queue: they block everything downstream.
  remaining.sort((a, b) => {
    const ga = hiddenGapIds.has(a.id) ? 0 : 1;
    const gb = hiddenGapIds.has(b.id) ? 0 : 1;
    if (ga !== gb) return ga - gb;
    return (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0);
  });

  // How aggressively we can pace: available days vs. required study minutes.
  const perDay = Math.max(15, dailyMinutes || 45);
  const deadlineDate = deadline ? new Date(`${deadline}T00:00:00`) : null;
  const daysAvailable = deadlineDate
    ? Math.max(1, Math.round((deadlineDate.getTime() - today.getTime()) / 86_400_000))
    : remaining.length * 2;

  const totalMinutes = remaining.reduce((sum, n) => {
    const gapToClose = Math.max(0.15, MASTERED - (mastery.get(n.id) ?? 0));
    return sum + Number(n.effort_hours) * 60 * gapToClose;
  }, 0);
  const daysNeeded = Math.max(remaining.length, Math.ceil(totalMinutes / perDay));
  const compression = Math.min(1, daysAvailable / daysNeeded);

  const nameById = new Map(nodes.map((n) => [n.id, n.name]));
  const entries: PlanEntry[] = [];
  let dayCursor = 0;

  for (const node of remaining) {
    const current = mastery.get(node.id) ?? 0;
    const gapToClose = Math.max(0.15, MASTERED - current);
    const rawMinutes = Number(node.effort_hours) * 60 * gapToClose;
    const sessionMinutes = Math.max(
      20,
      Math.min(perDay, Math.round((rawMinutes * (compression || 1)) / 5) * 5),
    );
    const sessions = Math.max(1, Math.ceil((rawMinutes * (compression || 1)) / perDay));

    const prereqIds = edges.filter((e) => e.to_node_id === node.id).map((e) => e.from_node_id);
    const prerequisites = prereqIds.map((id) => nameById.get(id) ?? "").filter(Boolean);
    const prerequisitesReady = prereqIds.every((id) => (mastery.get(id) ?? 0) >= MASTERED);
    const blocking = edges
      .filter((e) => e.from_node_id === node.id)
      .map((e) => nameById.get(e.to_node_id))
      .filter(Boolean) as string[];

    const reason = hiddenGapIds.has(node.id)
      ? `Hidden prerequisite — nothing downstream is safe until this is covered.`
      : blocking.length
        ? `${blocking[0]} depends on this skill, and your current mastery is ${Math.round(current * 100)}%.`
        : `Direct requirement of your goal. Current mastery ${Math.round(current * 100)}%.`;

    for (let s = 0; s < sessions; s += 1) {
      entries.push({
        node,
        date: addDays(today, dayCursor),
        minutes: sessionMinutes,
        difficulty: difficultyOf(node, depth.get(node.id) ?? 0),
        mastery: current,
        reason,
        prerequisites,
        prerequisitesReady,
        isHiddenGap: hiddenGapIds.has(node.id),
        done: false,
      });
      dayCursor += 1;
    }
  }

  return entries;
}
