import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  InfoTip,
  InlineLoading,
  MasteryReadout,
  ProgressBar,
  Skeleton,
} from "@/components/Primitives";
import { HELP_TEXT } from "@/lib/mastery";
import { useSkillDna } from "@/lib/useSkillDna";
import { MASTERED } from "@/lib/pathmind";

export const Route = createFileRoute("/_authenticated/gaps")({
  head: () => ({
    meta: [
      { title: "Skill gap reveal — PathMind" },
      {
        name: "description",
        content:
          "The prerequisites you're weak on, plus the hidden ones no course you've taken ever covered.",
      },
      { property: "og:title", content: "Skill gap reveal — PathMind" },
      {
        property: "og:description",
        content: "Diagnosed gaps and hidden prerequisites blocking your goal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GapsPage,
});

function GapsPage() {
  const dna = useSkillDna();

  const diagnosed = dna.nodes
    .filter((n) => !dna.hiddenGapIds.has(n.id))
    .filter((n) => dna.stateByNode.has(n.id))
    .filter((n) => (dna.decayed.get(n.id) ?? 0) < MASTERED)
    .sort((a, b) => (dna.decayed.get(a.id) ?? 0) - (dna.decayed.get(b.id) ?? 0));

  return (
    <AppShell
      title="What's between you and your goal"
      subtitle={
        dna.goalNode
          ? `Here's what stands between you and ${dna.goalNode.name} — including a couple of things you probably didn't know you were missing.`
          : "Tell us your goal and we'll show you exactly what's left to pick up."
      }
      actions={
        <Link to="/plan">
          <Button variant="secondary">See the plan</Button>
        </Link>
      }
    >
      {dna.error ? (
        <div className="mb-6">
          <ErrorState
            message="We couldn't load your gaps just now."
            onRetry={() => window.location.reload()}
          />
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="border-warning/40">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                Things you didn't know you were missing
                <InfoTip label="hidden gap" text={HELP_TEXT.hiddenGap} />
              </span>
            }
            subtitle="Your goal quietly depends on these, and nothing you've told us or answered covers them yet."
          />
          <div className="space-y-4 px-5 pb-6 pt-4 sm:px-6">
            {dna.gapsLoading ? (
              <>
                <InlineLoading label="Checking what your goal quietly depends on…" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </>
            ) : dna.hiddenGaps.length === 0 ? (
              <EmptyState
                title="Nothing hidden here"
                description="Everything your goal depends on is either something we've tested you on or something your courses covered."
              />
            ) : (
              dna.hiddenGaps.map((gap) => (
                <div
                  key={gap.id}
                  className={`rounded-xl border p-5 ${
                    gap.provisional
                      ? "border-border bg-surface-raised"
                      : "border-warning/45 bg-warning-soft"
                  }`}
                >
                  <Badge tone={gap.provisional ? "neutral" : "warning"}>
                    {gap.provisional ? "Claimed, not yet verified" : "Missing piece we spotted"}
                  </Badge>
                  <h3 className="mt-3 text-lg font-semibold text-foreground">{gap.name}</h3>
                  <p className="mt-2 text-sm text-foreground">
                    {gap.provisional
                      ? "You said a course covered this — calibration will confirm it."
                      : "Not listed in any course you completed, but required for your goal."}
                  </p>
                  <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                    <li>
                      Needed for{" "}
                      <span className="text-foreground">{dna.goalNode?.name ?? "your goal"}</span>
                    </li>
                    {gap.provisional ? (
                      <li>Covered by self-reported coursework only</li>
                    ) : (
                      <li>Not covered by the courses you told us about</li>
                    )}
                    <li>We've never asked you a question about it</li>
                  </ul>
                  <p className="mt-3 text-sm text-muted-foreground">{gap.reason}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{gap.effort_hours} h to close</Badge>
                    <Link to="/bridge/$nodeId" params={{ nodeId: gap.id }}>
                      <Button size="sm">Generate bridge module</Button>
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Skills you've started but haven't locked in"
            subtitle="You've answered questions on these, and they're not quite solid yet."
          />
          <div className="space-y-3 px-5 pb-6 pt-4 sm:px-6">
            {dna.loading ? (
              <>
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </>
            ) : diagnosed.length === 0 ? (
              <EmptyState
                title="Nothing weak right now"
                description="Answer a few questions to sharpen this picture, or head straight to your plan."
              />
            ) : (
              diagnosed.map((node) => {
                const value = dna.decayed.get(node.id) ?? 0;
                return (
                  <div
                    key={node.id}
                    className="rounded-xl border border-border bg-card px-4 py-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium text-foreground">{node.name}</p>
                      <MasteryReadout value={value} size="sm" className="shrink-0" />
                    </div>
                    <ProgressBar
                      value={value * 100}
                      tone={value < 0.4 ? "warning" : "primary"}
                      className="mt-2.5"
                    />
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
