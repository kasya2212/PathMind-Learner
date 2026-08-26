import { supabase } from "@/integrations/supabase/client";
import { HARD_PREREQ_WEIGHT } from "@/lib/replan";

export type SkillNode = {
  id: string;
  domain: string;
  name: string;
  description: string | null;
  effort_hours: number;
  is_required: boolean;
  market_weight: number;
};

export type SkillEdge = {
  id: string;
  from_node_id: string;
  to_node_id: string;
  weight: number;
};

export type DiagnosticOption = { id: string; text: string };

export type DiagnosticItem = {
  id: string;
  skill_node_id: string;
  question_text: string;
  options: DiagnosticOption[];
  correct_option_id: string;
  difficulty: number;
};

export type LearnerState = {
  skill_node_id: string;
  p_mastery: number;
  observation_count: number;
  last_practiced_at: string | null;
  /** Bridge-module exposure only — never BKT evidence. */
  last_exposed_at: string | null;
};

export const DOMAIN = "java_backend";
export const CAPSTONE_NAME = "Build & Deploy a Backend Service (capstone)";

export const PROBE_NODES = [
  "Java Syntax Basics",
  "OOP Design Principles",
  "Multithreading & Concurrency",
  "SQL Fundamentals",
  "REST API Design",
  "Spring Boot",
];

export const COURSE_CATALOG: { label: string; nodes: string[] }[] = [
  { label: "Intro to Java", nodes: ["Java Syntax Basics"] },
  { label: "Git Basics", nodes: ["Git & Version Control"] },
  { label: "Linux Command Line Crash Course", nodes: ["Linux CLI Basics"] },
  { label: "Object-Oriented Programming in Java", nodes: ["OOP Design Principles", "Exception Handling"] },
  { label: "Java Collections Deep Dive", nodes: ["Collections & Generics"] },
  { label: "Concurrency in Practice", nodes: ["Multithreading & Concurrency"] },
  { label: "SQL for Beginners", nodes: ["SQL Fundamentals"] },
  { label: "Databases with JDBC", nodes: ["JDBC & Database Connectivity"] },
  { label: "Designing REST APIs", nodes: ["REST API Design"] },
  { label: "Spring Boot Fundamentals", nodes: ["Spring Core (DI/IoC)", "Spring Boot"] },
  { label: "Docker for Developers", nodes: ["Docker Basics"] },
];

/**
 * Fetches one domain's graph. Defaults to the seeded Java Backend template;
 * learners with a generated custom domain pass their own domain slug so
 * graphs never mix. Edges carry no domain column, so they are filtered by
 * membership in the domain's node set.
 */
export async function fetchGraph(domain: string = DOMAIN) {
  const [nodesRes, edgesRes] = await Promise.all([
    supabase.from("skill_nodes").select("*").eq("domain", domain),
    supabase.from("skill_edges").select("*"),
  ]);
  if (nodesRes.error) throw nodesRes.error;
  if (edgesRes.error) throw edgesRes.error;
  const nodes = (nodesRes.data ?? []) as SkillNode[];
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: ((edgesRes.data ?? []) as SkillEdge[]).filter(
      (e) => ids.has(e.from_node_id) && ids.has(e.to_node_id),
    ),
  };
}

/** The domain a goal node belongs to — the learner's active graph. */
export async function fetchDomainForNode(nodeId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("skill_nodes")
    .select("domain")
    .eq("id", nodeId)
    .maybeSingle();
  if (error) throw error;
  return (data?.domain as string | undefined) ?? null;
}

export async function fetchLearnerStates(userId: string): Promise<LearnerState[]> {
  const { data, error } = await supabase
    .from("learner_skill_state")
    .select("skill_node_id, p_mastery, observation_count, last_practiced_at, last_exposed_at")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []) as LearnerState[];
}

export type ResponseTimestamp = { skill_node_id: string; created_at: string };

/** Timestamps only — input to the advisory pace signal (src/lib/evidence.ts). */
export async function fetchLearnerResponses(userId: string): Promise<ResponseTimestamp[]> {
  const { data, error } = await supabase
    .from("learner_responses")
    .select("skill_node_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as ResponseTimestamp[];
}

export async function fetchDiagnosticItems(nodeIds: string[]): Promise<DiagnosticItem[]> {
  const { data, error } = await supabase
    .from("diagnostic_items")
    .select("*")
    .in("skill_node_id", nodeIds);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    options: (row.options as unknown as DiagnosticOption[]) ?? [],
  })) as DiagnosticItem[];
}

/** Layered (topological) layout: each node sits one layer past its deepest prerequisite. */
export function layerNodes(nodes: SkillNode[], edges: SkillEdge[]) {
  const depth = new Map<string, number>();
  nodes.forEach((n) => depth.set(n.id, 0));
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
  return depth;
}

export function requiredPrereqIds(nodeId: string, nodes: SkillNode[], edges: SkillEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges
    .filter(
      (e) =>
        e.to_node_id === nodeId &&
        Number(e.weight) >= HARD_PREREQ_WEIGHT &&
        byId.get(e.from_node_id)?.is_required,
    )
    .map((e) => e.from_node_id);
}

export const MASTERED = 0.7;

export function isUnlocked(
  nodeId: string,
  nodes: SkillNode[],
  edges: SkillEdge[],
  mastery: Map<string, number>,
) {
  return requiredPrereqIds(nodeId, nodes, edges).every((id) => (mastery.get(id) ?? 0) >= MASTERED);
}

export function recommendNext(
  nodes: SkillNode[],
  edges: SkillEdge[],
  mastery: Map<string, number>,
): SkillNode | null {
  const depth = layerNodes(nodes, edges);
  const candidates = nodes
    .filter((n) => (mastery.get(n.id) ?? 0) < MASTERED)
    .filter((n) => isUnlocked(n.id, nodes, edges, mastery))
    .sort((a, b) => {
      if (a.is_required !== b.is_required) return a.is_required ? -1 : 1;
      const da = depth.get(a.id) ?? 0;
      const db = depth.get(b.id) ?? 0;
      if (da !== db) return da - db;
      return Number(a.effort_hours) - Number(b.effort_hours);
    });
  return candidates[0] ?? null;
}

export function masteryTone(mastery: number | undefined) {
  if (mastery === undefined) return "none" as const;
  if (mastery < 0.4) return "low" as const;
  if (mastery <= 0.7) return "mid" as const;
  return "high" as const;
}

export type LearnerProfile = {
  user_id: string;
  display_name: string | null;
  goal_text: string | null;
  goal_node_id: string | null;
  skill_level: string;
  learning_style: string | null;
  subjects: string[];
  completed_courses: string[];
  daily_time_minutes: number | null;
  deadline_date: string | null;
};

export const LEARNING_STYLES = [
  { value: "hands_on", label: "Hands-on projects", hint: "Learn by building things" },
  { value: "structured", label: "Structured courses", hint: "Step-by-step curriculum" },
  { value: "reading", label: "Docs & reading", hint: "Specs, books, articles" },
  { value: "mixed", label: "A mix of everything", hint: "Whatever fits the topic" },
];

/** Topics a learner can prioritise. Values match skill_nodes.name. */
export const SUBJECT_OPTIONS = [
  "Java Syntax Basics",
  "OOP Design Principles",
  "Collections & Generics",
  "Exception Handling",
  "Multithreading & Concurrency",
  "SQL Fundamentals",
  "JDBC & Database Connectivity",
  "REST API Design",
  "Spring Core (DI/IoC)",
  "Spring Boot",
  "Spring Security & Auth (JWT)",
  "Testing (JUnit/Mockito)",
  "Git & Version Control",
  "Linux CLI Basics",
  "Docker Basics",
];

export async function fetchProfile(userId: string): Promise<LearnerProfile | null> {
  const { data, error } = await supabase
    .from("learner_constraints")
    .select(
      "user_id, display_name, goal_text, goal_node_id, skill_level, learning_style, subjects, completed_courses, daily_time_minutes, deadline_date",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as LearnerProfile | null) ?? null;
}

export async function saveProfile(userId: string, patch: Partial<LearnerProfile>) {
  const { error } = await supabase.from("learner_constraints").upsert(
    {
      user_id: userId,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}
