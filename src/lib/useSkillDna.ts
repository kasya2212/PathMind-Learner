import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { decayMastery } from "@/lib/bkt";
import { computePaceByNode, isReviewDue } from "@/lib/evidence";
import { goalSubgraph } from "@/lib/graph";
import { buildTrainingPlan } from "@/lib/plan";
import { detectHiddenGaps } from "@/lib/skilldna.functions";
import {
  DOMAIN,
  MASTERED,
  fetchDomainForNode,
  fetchGraph,
  fetchLearnerResponses,
  fetchLearnerStates,
  fetchProfile,
  recommendNext,
  type LearnerState,
  type SkillNode,
} from "@/lib/pathmind";

/**
 * Single source of truth for every Skill DNA surface: scoped graph, decayed
 * mastery, hidden gaps, recommendation and training plan all derive from the
 * learner's real state. No screen recomputes this on its own.
 *
 * The goal comes ONLY from the persisted `goal_node_id` — free-text goal
 * re-derivation used to disagree with the backend planner. Roadmap snapshots
 * are written exclusively by the `replan()` server function.
 */
export function useSkillDna() {
  const { user } = useAuth();
  const userId = user?.id;
  const detect = useServerFn(detectHiddenGaps);

  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    queryFn: () => fetchProfile(userId!),
    enabled: Boolean(userId),
  });
  const profile = profileQuery.data ?? null;

  // The learner's domain derives from their persisted goal node — the seeded
  // Java Backend template when no goal is set, a generated custom domain
  // otherwise. The graph query is keyed by domain so graphs never mix.
  const domainQuery = useQuery({
    queryKey: ["graph-domain", userId, profile?.goal_node_id],
    enabled: Boolean(userId) && !profileQuery.isPending,
    queryFn: async () => {
      if (!profile?.goal_node_id) return DOMAIN;
      return (await fetchDomainForNode(profile.goal_node_id)) ?? DOMAIN;
    },
    staleTime: 300_000,
  });
  const domain = domainQuery.data ?? DOMAIN;

  const graphQuery = useQuery({
    queryKey: ["skill-graph", domain],
    queryFn: () => fetchGraph(domain),
    enabled: Boolean(domainQuery.data),
  });
  const stateQuery = useQuery({
    queryKey: ["learner-state", userId],
    queryFn: () => fetchLearnerStates(userId!),
    enabled: Boolean(userId),
  });
  // Response timestamps feed the advisory pace signal only — display-only,
  // never written back and never read by replan().
  const responsesQuery = useQuery({
    queryKey: ["learner-responses", userId],
    queryFn: () => fetchLearnerResponses(userId!),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });

  const allNodes = graphQuery.data?.nodes ?? [];
  const allEdges = graphQuery.data?.edges ?? [];

  const goalNode: SkillNode | null = useMemo(() => {
    if (!allNodes.length || !profile?.goal_node_id) return null;
    return allNodes.find((n) => n.id === profile.goal_node_id) ?? null;
  }, [allNodes, profile?.goal_node_id]);

  const states: LearnerState[] = stateQuery.data ?? [];

  const rawMastery = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of states) map.set(s.skill_node_id, Number(s.p_mastery));
    return map;
  }, [states]);

  const decayed = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of states) {
      map.set(
        s.skill_node_id,
        decayMastery({
          p_mastery: Number(s.p_mastery),
          observation_count: Number(s.observation_count),
          last_practiced_at: s.last_practiced_at,
        }),
      );
    }
    return map;
  }, [states]);

  const stateByNode = useMemo(
    () => new Map(states.map((s) => [s.skill_node_id, s])),
    [states],
  );

  const scoped = useMemo(
    () =>
      goalSubgraph({
        nodes: allNodes,
        edges: allEdges,
        goalId: goalNode?.id ?? null,
        subjectNames: profile?.subjects ?? [],
      }),
    [allNodes, allEdges, goalNode?.id, profile?.subjects],
  );

  const gapsQuery = useQuery({
    queryKey: ["hidden-gaps", userId, goalNode?.id],
    enabled: Boolean(userId && goalNode?.id),
    queryFn: () => detect({ data: { goal_node_id: goalNode!.id } }),
    staleTime: 60_000,
  });

  const hiddenGapIds = useMemo(
    () => new Set((gapsQuery.data?.hidden ?? []).map((g) => g.id)),
    [gapsQuery.data],
  );

  const next = useMemo(
    () => (scoped.nodes.length ? recommendNext(scoped.nodes, scoped.edges, decayed) : null),
    [scoped, decayed],
  );

  const plan = useMemo(
    () =>
      buildTrainingPlan({
        nodes: scoped.nodes,
        edges: scoped.edges,
        mastery: decayed,
        hiddenGapIds,
        dailyMinutes: profile?.daily_time_minutes ?? 45,
        deadline: profile?.deadline_date ?? null,
      }),
    [scoped, decayed, hiddenGapIds, profile?.daily_time_minutes, profile?.deadline_date],
  );

  // Roadmap snapshots are archived exclusively by the replan() server
  // function — it owns ordering, diffing, idempotency and locking.

  // Spaced review: once-solid skills whose decayed mastery has faded below
  // the review threshold. Pure read-time derivation from learner state —
  // no table, no history rows, no replan involvement.
  const reviewDue = useMemo(() => {
    const nameById = new Map(allNodes.map((n) => [n.id, n.name]));
    return states
      .filter((s) => isReviewDue(s, decayed.get(s.skill_node_id)))
      .map((s) => ({
        nodeId: s.skill_node_id,
        name: nameById.get(s.skill_node_id) ?? "A skill",
        decayed: decayed.get(s.skill_node_id) ?? 0,
      }))
      .sort((a, b) => a.decayed - b.decayed);
  }, [states, decayed, allNodes]);

  // Advisory pace verdicts per skill (insufficient-evidence nodes are
  // absent — callers default them to "insufficient").
  const paceByNode = useMemo(
    () => computePaceByNode(responsesQuery.data ?? []),
    [responsesQuery.data],
  );

  const overall = useMemo(() => {
    if (!scoped.nodes.length) return 0;
    const total = scoped.nodes.reduce((sum, n) => sum + (decayed.get(n.id) ?? 0), 0);
    return total / scoped.nodes.length;
  }, [scoped.nodes, decayed]);

  const solid = scoped.nodes.filter((n) => (decayed.get(n.id) ?? 0) >= MASTERED).length;

  const daysLeft = useMemo(() => {
    if (!profile?.deadline_date) return null;
    const diff = new Date(`${profile.deadline_date}T00:00:00`).getTime() - Date.now();
    return Math.ceil(diff / 86_400_000);
  }, [profile?.deadline_date]);

  return {
    userId,
    profile,
    goalNode,
    nodes: scoped.nodes,
    edges: scoped.edges,
    allNodes,
    allEdges,
    scoped: scoped.scoped,
    rawMastery,
    decayed,
    stateByNode,
    hiddenGaps: gapsQuery.data?.hidden ?? [],
    hiddenGapIds,
    gapsLoading: gapsQuery.isPending && Boolean(goalNode?.id),
    next,
    plan,
    overall,
    solid,
    daysLeft,
    reviewDue,
    paceByNode,
    domain,
    loading:
      graphQuery.isPending ||
      stateQuery.isPending ||
      profileQuery.isPending ||
      domainQuery.isPending,
    error: graphQuery.isError || stateQuery.isError || profileQuery.isError || domainQuery.isError,
  };
}
