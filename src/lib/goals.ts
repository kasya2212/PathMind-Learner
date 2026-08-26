import { CAPSTONE_NAME } from "@/lib/pathmind";

/**
 * Goal resolution — the ONLY way free-text goals become a goal_node_id.
 *
 * The learner's typed goal is matched against a small set of supported
 * goals, each anchored to a real seeded skill_nodes row (the lookup space is
 * the Java Backend graph). Matching is deliberately conservative:
 *
 *  - exactly ONE preset matches  → confident, resolve to that node;
 *  - ZERO presets match          → unmappable: return null, keep the typed
 *                                  text, and ask the learner to pick;
 *  - MORE THAN ONE preset match  → ambiguous: return null and ask.
 *
 * We never fall back to the capstone (or any node) when mapping fails —
 * that was the original P0-3 bug.
 */

export const DEFAULT_GOAL_TEXT = "Become a Java Backend Developer";

export type GoalPreset = {
  key: string;
  label: string;
  blurb: string;
  /** Must match a seeded skill_nodes.name exactly. */
  nodeName: string;
  patterns: RegExp[];
};

export const SUPPORTED_GOALS: GoalPreset[] = [
  {
    key: "java-backend",
    label: "Java Backend Developer",
    blurb: "The full path — core Java, Spring, databases, and deploying a real service.",
    nodeName: CAPSTONE_NAME,
    patterns: [
      /\bback[- ]?end\b/,
      /\bfull[- ]?stack\b/,
      /\bcapstone\b/,
      /\bdeploy\b/,
      /\bjava\b[^.]*\b(developer|engineer|programmer)\b/,
    ],
  },
  {
    key: "spring-boot",
    label: "Spring Boot API Developer",
    blurb: "Building production REST services with Spring Boot.",
    nodeName: "Spring Boot",
    patterns: [/\bspring\b/, /\bboot\b/],
  },
  {
    key: "rest-api",
    label: "REST API Developer",
    blurb: "Designing and building clean HTTP APIs.",
    nodeName: "REST API Design",
    patterns: [/\brest\b/, /\bapis?\b/],
  },
  {
    key: "core-java",
    label: "Core Java Developer",
    blurb: "Deep Java fundamentals, through collections and concurrency.",
    nodeName: "Multithreading & Concurrency",
    patterns: [/\bcore\s+java\b/, /\bconcurrency\b/, /\bmulti-?thread/],
  },
  {
    key: "java-data",
    label: "Database-backed Java Developer",
    blurb: "SQL and JDBC — making Java talk to databases well.",
    nodeName: "JDBC & Database Connectivity",
    patterns: [/\bsql\b/, /\bdatabases?\b/, /\bjdbc\b/],
  },
];

/** Every preset whose patterns match the text (usually 0 or 1). */
export function matchGoalPresets(goalText: string): GoalPreset[] {
  const text = goalText.trim().toLowerCase();
  if (!text) return [];
  return SUPPORTED_GOALS.filter((g) => g.patterns.some((p) => p.test(text)));
}

/** The single confident match, or null when unmappable/ambiguous. */
export function resolveGoalPreset(goalText: string): GoalPreset | null {
  const matches = matchGoalPresets(goalText);
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Maps goal text to a real skill_nodes.id from the seeded graph, or null.
 * `nodes` is the caller-fetched skill_nodes list for the domain.
 */
export function resolveGoalNodeId(
  goalText: string,
  nodes: { id: string; name: string }[],
): string | null {
  const preset = resolveGoalPreset(goalText);
  if (!preset) return null;
  return nodes.find((n) => n.name === preset.nodeName)?.id ?? null;
}
