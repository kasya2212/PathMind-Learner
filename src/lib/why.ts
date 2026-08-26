/**
 * Assembles the "Why" explanation for a skill node.
 *
 * Everything here is derived from data the app already computed — decayed
 * mastery, skill_edges weights, market_weight, the hidden-gap detector and the
 * newest plan_history rows. Nothing is generated, guessed or paraphrased by a
 * model.
 */

import { MASTERED, type SkillEdge, type SkillNode } from "@/lib/pathmind";
import { masterySentence } from "@/lib/mastery";

import { HARD_PREREQ_WEIGHT } from "@/lib/replan";
import { isPlanSnapshotTrigger } from "@/lib/planHistory";
/** Alias of the single shared hard-prerequisite threshold (see replan.ts). */
const HARD_PREREQ = HARD_PREREQ_WEIGHT;

export type WhyPoint = {
  key: string;
  label: string;
  body: string;
  tone: "neutral" | "warning" | "primary";
};

export type PlanHistoryRow = {
  id: string;
  created_at: string;
  trigger: string | null;
  summary: string | null;
  reasoning: string | null;
  node_ids: string[];
};

export type WhyInput = {
  node: SkillNode;
  nodes: SkillNode[];
  edges: SkillEdge[];
  decayed: Map<string, number>;
  goalNode: SkillNode | null;
  isHiddenGap: boolean;
  history: PlanHistoryRow[];
};

function nameOf(nodes: SkillNode[], id: string) {
  return nodes.find((n) => n.id === id)?.name ?? "another skill";
}

/** Prerequisites of `node` that the learner can't yet do today. */
export function blockingPrerequisites(input: {
  node: SkillNode;
  nodes: SkillNode[];
  edges: SkillEdge[];
  decayed: Map<string, number>;
}): SkillNode[] {
  const { node, nodes, edges, decayed } = input;
  return edges
    .filter((e) => e.to_node_id === node.id && Number(e.weight) >= HARD_PREREQ)
    .map((e) => nodes.find((n) => n.id === e.from_node_id))
    .filter((n): n is SkillNode => Boolean(n))
    .filter((n) => (decayed.get(n.id) ?? 0) < MASTERED);
}

/** What the newest plan change did to this specific node, if anything. */
export function planChangeForNode(
  nodeId: string,
  history: PlanHistoryRow[],
): { change: "added" | "removed" | "reordered"; row: PlanHistoryRow } | null {
  const withPlans = history.filter((r) => r.node_ids.length > 0);
  const latest = withPlans[0];
  const previous = withPlans[1];
  if (!latest || !previous) return null;

  const inLatest = latest.node_ids.indexOf(nodeId);
  const inPrevious = previous.node_ids.indexOf(nodeId);
  if (inLatest >= 0 && inPrevious < 0) return { change: "added", row: latest };
  if (inLatest < 0 && inPrevious >= 0) return { change: "removed", row: latest };
  if (inLatest >= 0 && inPrevious >= 0 && inLatest !== inPrevious)
    return { change: "reordered", row: latest };
  return null;
}

export function buildWhy(input: WhyInput): WhyPoint[] {
  const { node, nodes, edges, decayed, goalNode, isHiddenGap, history } = input;
  const points: WhyPoint[] = [];

  points.push({
    key: "mastery",
    label: "Where you are with it today",
    body: `${masterySentence(decayed.get(node.id))}. That's what you could do right now, after a little natural fading since you last practised.`,
    tone: "neutral",
  });

  // Hard vs soft prerequisite, and for which downstream skill.
  const outgoing = edges.filter((e) => e.from_node_id === node.id);
  if (outgoing.length) {
    const hard = outgoing.filter((e) => Number(e.weight) >= HARD_PREREQ);
    const soft = outgoing.filter((e) => Number(e.weight) < HARD_PREREQ);
    const parts: string[] = [];
    if (hard.length) {
      parts.push(
        `It's a required prerequisite for ${hard
          .map((e) => nameOf(nodes, e.to_node_id))
          .join(", ")} — those stay locked until this one holds up.`,
      );
    }
    if (soft.length) {
      parts.push(
        `It also helps with ${soft
          .map((e) => nameOf(nodes, e.to_node_id))
          .join(", ")}, though it isn't strictly required there.`,
      );
    }
    points.push({
      key: "prereq",
      label: "How it fits your goal",
      body: parts.join(" "),
      tone: "neutral",
    });
  } else if (goalNode && goalNode.id === node.id) {
    points.push({
      key: "prereq",
      label: "How it fits your goal",
      body: "This is your goal itself — everything else on the map builds toward it.",
      tone: "primary",
    });
  } else {
    points.push({
      key: "prereq",
      label: "How it fits your goal",
      body: "Nothing else on your map depends on this one directly — it stands on its own.",
      tone: "neutral",
    });
  }

  points.push({
    key: "market",
    label: "Why it's worth your time",
    body: `Appears in about ${Math.round(
      Number(node.market_weight) * 100,
    )}% of relevant job listings, and takes roughly ${node.effort_hours} h to get comfortable with.`,
    tone: "neutral",
  });

  if (isHiddenGap) {
    points.push({
      key: "gap",
      label: "A missing piece we found",
      body: `Your goal${
        goalNode ? ` (${goalNode.name})` : ""
      } quietly depends on this, but we've never tested you on it and none of the courses you listed cover it. That's useful to know now rather than later.`,
      tone: "warning",
    });
  }

  const blockers = blockingPrerequisites({ node, nodes, edges, decayed });
  if (blockers.length) {
    points.push({
      key: "locked",
      label: "What's blocking it right now",
      body: `You'll want ${blockers
        .map((b) => b.name)
        .join(", ")} solid first — ${
        blockers.length === 1 ? "that's" : "those are"
      } what this one builds on.`,
      tone: "warning",
    });
  }

  const change = planChangeForNode(node.id, history);
  if (change) {
    const verb =
      change.change === "added"
        ? "was added to your plan"
        : change.change === "removed"
          ? "was taken out of your plan"
          : "moved to a different place in your plan";
    points.push({
      key: "plan",
      label: "What changed in your last re-plan",
      body: `${node.name} ${verb}. ${change.row.reasoning ?? change.row.summary ?? ""}`.trim(),
      tone: "primary",
    });
  }

  return points;
}

const TRIGGER_LABELS: Record<string, string> = {
  initial_plan: "First plan",
  plan_generated: "Plan rebuilt",
  time_budget_change: "Time budget changed",
  deadline_overdue: "Target date passed",
  hidden_gap_detected: "Missing piece found",
};

export function triggerLabel(trigger: string | null): string {
  if (!trigger) return "Plan updated";
  return TRIGGER_LABELS[trigger] ?? trigger.replace(/_/g, " ");
}

/** Warning-family treatment for gap/overdue rows; neutral/accent otherwise. */
export function triggerTone(
  trigger: string | null,
): "neutral" | "primary" | "warning" {
  if (trigger === "hidden_gap_detected" || trigger === "deadline_overdue") return "warning";
  if (trigger === "initial_plan" || trigger === "plan_generated") return "primary";
  return "neutral";
}

export const BRIDGE_FALLBACK_MARKER = "Bridge-module completion isn't tracked yet";
