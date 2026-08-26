import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { SkillGraph } from "@/components/SkillGraph";
import {
  BottomSheet,
  NodeInsight,
  PlanHistoryList,
  type NodeInsightData,
} from "@/components/NodeInsight";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  FadeScroll,
  GraphLegend,
  InfoTip,
  InlineLoading,
  MasteryReadout,
  ProgressBar,
  Skeleton,
} from "@/components/Primitives";
import { HELP_TEXT, masteryBand } from "@/lib/mastery";
import { useSkillDna } from "@/lib/useSkillDna";
import { usePlanHistory } from "@/lib/usePlanHistory";
import { MASTERED } from "@/lib/pathmind";


export const Route = createFileRoute("/_authenticated/skill-dna")({
  head: () => ({
    meta: [
      { title: "Skill DNA — PathMind" },
      {
        name: "description",
        content:
          "Your live Skill DNA: mastery per skill, forgetting-curve decay and the hidden prerequisites blocking your goal.",
      },
      { property: "og:title", content: "Skill DNA — PathMind" },
      {
        property: "og:description",
        content: "An interactive map of what you know, what you're forgetting and what's missing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SkillDnaPage,
});

function SkillDnaPage() {
  const dna = useSkillDna();
  const history = usePlanHistory();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = dna.nodes.find((n) => n.id === selectedId) ?? null;
  const selectedState = selectedId ? dna.stateByNode.get(selectedId) : undefined;

  const insight: NodeInsightData | null = useMemo(() => {
    if (!selected) return null;
    return {
      node: selected,
      nodes: dna.nodes,
      edges: dna.edges,
      decayed: dna.decayed,
      rawMastery: dna.rawMastery,
      goalNode: dna.goalNode ?? null,
      isHiddenGap: dna.hiddenGapIds.has(selected.id),
      observationCount: selectedState?.observation_count ?? 0,
      lastPracticedAt: selectedState?.last_practiced_at ?? null,
      lastExposedAt: selectedState?.last_exposed_at ?? null,
      pace: dna.paceByNode.get(selected.id) ?? "insufficient",
      history: history.rows,
      historyLoading: history.loading,
    };
  }, [selected, selectedState, dna, history.rows, history.loading]);

  // Skill categories as compact pills — counts derive from the same decayed
  // mastery bands as the graph colours (Strong / Developing / Starting /
  // Unexplored) plus the two watch-list signals (fading, missing).
  const buckets = useMemo(() => {
    const b = { high: 0, mid: 0, low: 0, none: 0 };
    for (const n of dna.nodes) b[masteryBand(dna.decayed.get(n.id))] += 1;
    return b;
  }, [dna.nodes, dna.decayed]);

  return (
    <AppShell
      title="Skill DNA"
      subtitle={
        dna.goalNode
          ? `Everything between where you are and ${dna.goalNode.name}.`
          : "Pick a goal in your profile to scope this graph."
      }
      actions={
        <Link to="/diagnostic">
          <Button variant="secondary">Recalibrate</Button>
        </Link>
      }
    >
      {dna.error ? <ErrorState /> : null}

      {/* Compact summary strip — height follows content, never fixed. */}
      <Card className="animate-enter px-5 py-4 sm:px-6">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              Where you are overall
              <InfoTip label="decayed" text={HELP_TEXT.decayed} />
            </dt>
            <dd className="mt-1.5">
              {dna.loading ? (
                <Skeleton className="h-6 w-24" />
              ) : (
                <MasteryReadout value={dna.overall} size="md" />
              )}
            </dd>
            <dd className="mt-2">
              <ProgressBar value={dna.overall * 100} className="h-1.5" />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">
              Skills you've got down
            </dt>
            <dd className="mt-1.5">
              {dna.loading ? (
                <Skeleton className="h-6 w-16" />
              ) : (
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {dna.solid} / {dna.nodes.length}
                </span>
              )}
            </dd>
            <dd className="mt-0.5 text-xs text-muted-foreground">
              {Math.round(MASTERED * 100)}%+ today counts as solid
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              Missing pieces
              <InfoTip label="hidden gap" text={HELP_TEXT.hiddenGap} />
            </dt>
            <dd className="mt-1.5">
              {dna.gapsLoading ? (
                <Skeleton className="h-6 w-10" />
              ) : (
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {dna.hiddenGaps.length}
                </span>
              )}
            </dd>
            <dd className="mt-0.5 text-xs text-muted-foreground">Needed before your goal</dd>
          </div>
        </dl>

        {/* Category pills — the whole map's shape at a glance. */}
        {!dna.loading && dna.nodes.length ? (
          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border pt-3.5">
            <CategoryPill
              swatch="bg-mastery-high"
              label="Strong"
              count={buckets.high}
            />
            <CategoryPill
              swatch="bg-mastery-mid"
              label="Developing"
              count={buckets.mid}
            />
            <CategoryPill
              swatch="bg-mastery-low"
              label="Just starting"
              count={buckets.low}
            />
            <CategoryPill
              swatch="bg-mastery-none"
              label="Not explored"
              count={buckets.none}
            />
            {dna.reviewDue.length ? (
              <CategoryPill swatch="bg-warning" label="Fading" count={dna.reviewDue.length} />
            ) : null}
            {dna.hiddenGaps.length ? (
              <CategoryPill
                swatch="bg-warning"
                outline
                label="Missing prerequisite"
                count={dna.hiddenGaps.length}
              />
            ) : null}
          </div>
        ) : null}
      </Card>

      {/* The graph is the centerpiece: ~72% width on desktop, panel ~28%. */}
      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,72fr)_minmax(0,28fr)]">
        <Card className="animate-enter self-start overflow-hidden">
          <CardHeader
            title="Your skill graph"
            subtitle="Click a node for detail. Drag to pan, ⌘/Ctrl + scroll or the controls to zoom."
            action={<GraphLegend className="max-w-full" />}
          />
          <div className="mt-3 px-2 pb-4">
            {dna.loading ? (
              <div className="px-4">
                <InlineLoading label="Mapping your current skills…" />
                <Skeleton className="mt-4 h-[460px] w-full" />
              </div>

            ) : dna.nodes.length ? (
              <SkillGraph
                nodes={dna.nodes}
                edges={dna.edges}
                mastery={dna.decayed}
                recommendedId={dna.next?.id}
                hiddenGapIds={dna.hiddenGapIds}
                selectedId={selectedId}
                onSelect={setSelectedId}
                height={560}
              />
            ) : (
              <EmptyState
                title="No graph yet"
                description="Choose a goal and subjects in your profile and your Skill DNA appears here."
              />
            )}
          </div>
        </Card>

        {/* Right rail: two independent compact sections, sizes to content. */}
        <div className="grid h-fit content-start gap-5 xl:sticky xl:top-20">
          {/* Desktop: persistent explanation panel; mobile uses the bottom sheet.
              Raised depth treatment — one of the app's three depth surfaces. */}
          <Card className="hidden shadow-[var(--shadow-raised)] lg:block">
            <CardHeader title={selected ? selected.name : "Node details"} />
            <div className="px-5 pb-5 pt-3 sm:px-6">
              {!selected ? (
                <p className="text-sm text-muted-foreground">
                  Select a skill in the graph to view its progress, prerequisites, and role in
                  your learning path.
                </p>
              ) : (
                <NodeInsight data={insight!} />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="How your plan has changed"
              subtitle="Grouped by what changed together — newest first."
            />
            <FadeScroll maxHeightClass="max-h-[26rem]" className="px-4 pb-4 sm:px-5">
              <PlanHistoryList rows={history.rows} loading={history.loading} />
            </FadeScroll>
          </Card>
        </div>
      </div>

      {/* Mobile/tablet: the same panel as a dismissible bottom sheet. */}
      {selected && insight ? (
        <BottomSheet title={selected.name} onClose={() => setSelectedId(null)}>
          <NodeInsight data={insight} />
        </BottomSheet>
      ) : null}
    </AppShell>
  );
}

/** Compact mastery-category chip: colour swatch + label + count. */
function CategoryPill({
  swatch,
  label,
  count,
  outline,
}: {
  swatch: string;
  label: string;
  count: number;
  outline?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-sunken px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${swatch} ${outline ? "opacity-70" : ""}`}
        style={outline ? { background: "transparent", border: "2px dashed var(--warning)" } : undefined}
      />
      {label}
      <span className="tabular-nums text-foreground">{count}</span>
    </span>
  );
}

