import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton } from "@/components/Primitives";
import {
  completeBridgeModule,
  generateBridgeModule,
  recordExposure,
} from "@/lib/skilldna.functions";
import { useSkillDna } from "@/lib/useSkillDna";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/bridge/$nodeId")({
  head: () => ({
    meta: [
      { title: "Bridge module — PathMind" },
      {
        name: "description",
        content:
          "A focused 7-10 day bridge module that closes one missing prerequisite before it blocks your goal.",
      },
      { property: "og:title", content: "Bridge module — PathMind" },
      {
        property: "og:description",
        content: "An AI-built micro-curriculum for a single missing skill.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BridgePage,
});

type BridgeRow = {
  id: string;
  title: string;
  tasks: string[];
  status: string;
  created_at: string;
};

function BridgePage() {
  const { nodeId } = useParams({ from: "/_authenticated/bridge/$nodeId" });
  const dna = useSkillDna();
  const queryClient = useQueryClient();
  const generate = useServerFn(generateBridgeModule);

  const node = dna.allNodes.find((n) => n.id === nodeId) ?? null;

  const existing = useQuery({
    queryKey: ["bridge", dna.userId, nodeId],
    enabled: Boolean(dna.userId),
    queryFn: async (): Promise<BridgeRow | null> => {
      const { data, error } = await supabase
        .from("bridge_modules")
        .select("id, title, tasks, status, created_at")
        .eq("user_id", dna.userId!)
        .eq("skill_node_id", nodeId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { ...data, tasks: (data.tasks as unknown as string[]) ?? [] };
    },
  });

  const mutation = useMutation({
    mutationFn: () =>
      generate({ data: { skill_node_id: nodeId, goal_node_id: dna.goalNode?.id ?? null } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bridge", dna.userId, nodeId] });
    },
  });

  const complete = useServerFn(completeBridgeModule);
  const completeMutation = useMutation({
    mutationFn: (bridgeId: string) => complete({ data: { bridge_id: bridgeId } }),
    onSuccess: async () => {
      // A completed bridge frees plan time and can resolve the hidden gap.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["bridge", dna.userId, nodeId] }),
        queryClient.invalidateQueries({ queryKey: ["learner-state", dna.userId] }),
        queryClient.invalidateQueries({ queryKey: ["hidden-gaps", dna.userId] }),
        queryClient.invalidateQueries({ queryKey: ["plan-snapshot", dna.userId] }),
      ]);
    },
  });

  const bridge = existing.data;
  const bridgeDone = bridge?.status === "complete";

  // Exposure signal: this screen is the ONLY place a learner views
  // instructional material, so opening a generated bridge stamps
  // last_exposed_at — proof the screen was opened, never proof of study.
  // No mastery, no observation count, no history rows are touched.
  const record = useServerFn(recordExposure);
  const exposureRecorded = useRef<string | null>(null);
  useEffect(() => {
    if (!bridge || exposureRecorded.current === bridge.id) return;
    exposureRecorded.current = bridge.id;
    void record({ data: { skill_node_id: nodeId } })
      .catch(() => undefined)
      .then(() =>
        queryClient.invalidateQueries({ queryKey: ["learner-state", dna.userId] }),
      );
  }, [bridge, nodeId, record, queryClient, dna.userId]);

  return (
    <AppShell
      title={node ? `${node.name} bridge` : "Bridge module"}
      subtitle="A short, focused detour that closes one missing prerequisite — nothing else."
      actions={
        <Link to="/gaps">
          <Button variant="secondary">Back to gaps</Button>
        </Link>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader
            title="7–10 day plan"
            subtitle={node?.description ?? "Generated for this skill only."}
            action={
              <Button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                size="sm"
                variant={bridge ? "secondary" : "primary"}
              >
                {mutation.isPending
                  ? "Generating…"
                  : bridge
                    ? "Regenerate"
                    : "Generate bridge module"}
              </Button>
            }
          />
          <div className="px-5 pb-6 pt-4 sm:px-6">
            {mutation.isError ? (
              <p className="mb-4 rounded-xl border border-destructive/40 bg-destructive-soft px-4 py-3 text-sm text-destructive">
                {(mutation.error as Error).message}
              </p>
            ) : null}

            {existing.isPending || mutation.isPending ? (
              <div className="space-y-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : !bridge ? (
              <EmptyState
                title="No bridge module yet"
                description="Generate a focused micro-curriculum for this skill. It stays scoped to this one prerequisite."
              />
            ) : (
              <ol className="space-y-3">
                {bridge.tasks.map((task, index) => (
                  <li
                    key={index}
                    className="flex gap-3 rounded-xl border border-border bg-card px-4 py-4"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                      {index + 1}
                    </span>
                    <p className="text-sm leading-relaxed text-foreground">{task}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Card>

        <Card className="h-fit p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Why this bridge
          </p>
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">
            {bridgeDone ? (
              <Badge tone="success">✓ Bridge complete</Badge>
            ) : dna.hiddenGapIds.has(nodeId) ? (
              <Badge tone="warning">⚠ Hidden prerequisite</Badge>
            ) : (
              <Badge tone="info">Prerequisite reinforcement</Badge>
            )}
            <p>
              {node?.name ?? "This skill"} is required for{" "}
              <span className="text-foreground">{dna.goalNode?.name ?? "your goal"}</span>, and your
              history shows no evidence you've covered it.
            </p>
            <p>
              Estimated effort:{" "}
              <span className="text-foreground">{node?.effort_hours ?? 0} hours</span>.
            </p>
            {bridge && !bridgeDone ? (
              <Button
                size="sm"
                className="min-h-11"
                onClick={() => completeMutation.mutate(bridge.id)}
                disabled={completeMutation.isPending}
              >
                {completeMutation.isPending ? "Saving…" : "Mark this bridge complete"}
              </Button>
            ) : null}
            {bridgeDone ? (
              <p className="text-xs">
                Completed — this bridge no longer takes up time in your plan.
              </p>
            ) : null}
            {completeMutation.isError ? (
              <p className="text-sm text-destructive" role="alert">
                We couldn't save that just now — try again.
              </p>
            ) : null}
            <Link to="/plan">
              <Button variant="ghost" size="sm" className="mt-1 px-0">
                See how it fits your plan →
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
