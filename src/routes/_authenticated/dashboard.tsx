import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  InfoTip,
  MasteryReadout,
  ProgressBar,
  Skeleton,
  inputClass,
} from "@/components/Primitives";
import { BottomSheet } from "@/components/NodeInsight";
import { InsightsRail } from "@/components/InsightsRail";
import { MASTERED, saveProfile } from "@/lib/pathmind";
import { HELP_TEXT, masteryLabel, masterySentence } from "@/lib/mastery";
import { paceLine } from "@/lib/evidence";
import { useSkillDna } from "@/lib/useSkillDna";
import { generateCustomDomain } from "@/lib/domains.functions";
import { usePlanHistory } from "@/lib/usePlanHistory";
import { updateMastery } from "@/lib/skilldna.functions";
import { getLatestPlanSnapshot, replan } from "@/lib/replan.functions";
import { EFFECTIVELY_MASTERED } from "@/lib/replan";
import { SUPPORTED_GOALS, type GoalPreset } from "@/lib/goals";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Your path — PathMind" },
      {
        name: "description",
        content:
          "Your learning overview: progress, the single next step PathMind recommends, plan health and what's coming up toward your goal.",
      },
      { property: "og:title", content: "Your path — PathMind" },
      {
        property: "og:description",
        content: "See your progress, hidden gaps and what to learn next.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function MagneticButton({
  children,
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ComponentProps<typeof Button>) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    if (reducedMotion || coarsePointer) return;

    let raf = 0;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;

    const apply = () => {
      const scale = 1 + (Math.abs(currentX) + Math.abs(currentY)) * 0.015;
      node.style.transform = `translate(${currentX}px, ${currentY}px) scale(${scale})`;
      raf = 0;
    };

    const onMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);

      targetX = clamp((dx / rect.width) * 7, -5, 5);
      targetY = clamp((dy / rect.height) * 7, -5, 5);

      if (!raf) {
        raf = window.requestAnimationFrame(() => {
          currentX += (targetX - currentX) * 0.25;
          currentY += (targetY - currentY) * 0.25;
          apply();
        });
      }
    };

    const onLeave = () => {
      targetX = 0;
      targetY = 0;
      if (!raf) {
        raf = window.requestAnimationFrame(() => {
          currentX += (targetX - currentX) * 0.2;
          currentY += (targetY - currentY) * 0.2;
          apply();
        });
      }
    };

    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerleave", onLeave);

    return () => {
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
      if (raf) window.cancelAnimationFrame(raf);
      node.style.transform = "";
    };
  }, []);

  return (
    <div ref={ref} className="inline-flex will-change-transform">
      <Button {...props} variant={variant} size={size} className={className}>
        {children}
      </Button>
    </div>
  );
}

function MagneticLink({
  children,
  className,
  to,
  variant = "primary",
  size = "md",
  ...props
}: React.ComponentProps<typeof Link> & {
  children: React.ReactNode;
  to: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    if (reducedMotion || coarsePointer) return;

    let raf = 0;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;

    const apply = () => {
      const scale = 1 + (Math.abs(currentX) + Math.abs(currentY)) * 0.015;
      node.style.transform = `translate(${currentX}px, ${currentY}px) scale(${scale})`;
      raf = 0;
    };

    const onMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);

      targetX = clamp((dx / rect.width) * 7, -5, 5);
      targetY = clamp((dy / rect.height) * 7, -5, 5);

      if (!raf) {
        raf = window.requestAnimationFrame(() => {
          currentX += (targetX - currentX) * 0.25;
          currentY += (targetY - currentY) * 0.25;
          apply();
        });
      }
    };

    const onLeave = () => {
      targetX = 0;
      targetY = 0;
      if (!raf) {
        raf = window.requestAnimationFrame(() => {
          currentX += (targetX - currentX) * 0.2;
          currentY += (targetY - currentY) * 0.2;
          apply();
        });
      }
    };

    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerleave", onLeave);

    return () => {
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
      if (raf) window.cancelAnimationFrame(raf);
      node.style.transform = "";
    };
  }, [to]);

  return (
    <Link
      ref={ref}
      to={to}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "px-3 py-1.5 text-xs",
        size === "md" && "px-4 py-2.5 text-sm",
        size === "lg" && "px-6 py-3 text-sm sm:text-base",
        variant === "primary" &&
          "bg-primary text-primary-foreground shadow-[var(--shadow-card)] hover:-translate-y-px hover:shadow-[var(--shadow-raised)] hover:brightness-110 active:translate-y-0 active:scale-[0.98] active:brightness-95",
        variant === "secondary" &&
          "border border-border bg-card text-foreground hover:-translate-y-px hover:bg-secondary active:translate-y-0 active:scale-[0.98]",
        variant === "ghost" && "text-muted-foreground hover:bg-secondary hover:text-foreground",
        variant === "danger" && "bg-destructive text-destructive-foreground hover:brightness-110",
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const dna = useSkillDna();
  const history = usePlanHistory();
  const queryClient = useQueryClient();

  const [deadline, setDeadline] = useState("");
  const [minutes, setMinutes] = useState("45");
  const [saved, setSaved] = useState(false);
  const [minutesError, setMinutesError] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [insightsSheetOpen, setInsightsSheetOpen] = useState(false);

  const runReplan = useServerFn(replan);
  const loadSnapshot = useServerFn(getLatestPlanSnapshot);
  const runUpdateMastery = useServerFn(updateMastery);

  // Live task-completion feedback: real BKT values, shown inline, faded out.
  // `via` tells us which surface triggered it so the feedback renders there.
  const [completion, setCompletion] = useState<{
    name: string;
    previous: number;
    next: number;
    via: "next" | "review";
  } | null>(null);
  const [completionVisible, setCompletionVisible] = useState(false);
  const fadeTimer = useRef<number | null>(null);
  const heroCardTiltRef = useRef<HTMLDivElement | null>(null);
  useEffect(
    () => () => {
      if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    },
    [],
  );

  // Hydrate the settings form once the profile lands. This is a plain local
  // form: saving never navigates and never touches the auth session.
  useEffect(() => {
    if (!dna.profile) return;
    setDeadline(dna.profile.deadline_date ?? "");
    setMinutes(String(dna.profile.daily_time_minutes ?? 45));
  }, [dna.profile]);

  useEffect(() => {
    const node = heroCardTiltRef.current;
    if (!node) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    if (reducedMotion || coarsePointer) return;

    let raf = 0;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;

    const apply = () => {
      node.style.transform = `perspective(1200px) rotateX(${currentY}deg) rotateY(${currentX}deg) translateY(-1px)`;
      raf = 0;
    };

    const onMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;

      targetY = clamp((0.5 - py) * 8, -4, 4);
      targetX = clamp((px - 0.5) * 8, -4, 4);

      if (!raf) {
        raf = window.requestAnimationFrame(() => {
          currentX += (targetX - currentX) * 0.14;
          currentY += (targetY - currentY) * 0.14;
          apply();
        });
      }
    };

    const onLeave = () => {
      targetX = 0;
      targetY = 0;
      if (!raf) {
        raf = window.requestAnimationFrame(() => {
          currentX += (targetX - currentX) * 0.14;
          currentY += (targetY - currentY) * 0.14;
          apply();
        });
      }
    };

    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerleave", onLeave);

    return () => {
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
      if (raf) window.cancelAnimationFrame(raf);
      node.style.transform = "";
    };
  }, []);

  const snapshotQuery = useQuery({
    queryKey: ["plan-snapshot", user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => loadSnapshot({}),
  });

  const savePlan = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      await saveProfile(user.id, {
        deadline_date: deadline || null,
        daily_time_minutes: Number(minutes),
      });
      // Constraints changed → recompute the roadmap.
      return await runReplan({});
    },
    onSuccess: async () => {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["profile", user?.id] }),
        queryClient.invalidateQueries({ queryKey: ["plan-snapshot", user?.id] }),
      ]);
    },
  });

  function handleSave() {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value <= 0) {
      setMinutesError("Add a little time here so we can build you a real plan.");
      return;
    }
    setMinutesError(null);
    savePlan.mutate();
  }

  function acceptSuggestedDate(date: string) {
    setDeadline(date);
    if (!user) return;
    savePlan.mutate();
  }

  const result = savePlan.data ?? null;

  // The next step comes from the newest archived plan ordering: the first node
  // in that list that isn't already effectively mastered today.
  const nextFromPlan = useMemo(() => {
    const ids = snapshotQuery.data?.node_ids ?? [];
    for (const id of ids) {
      const node = dna.allNodes.find((n) => n.id === id);
      if (!node) continue;
      if ((dna.decayed.get(id) ?? 0) >= EFFECTIVELY_MASTERED) continue;
      return node;
    }
    return null;
  }, [snapshotQuery.data, dna.allNodes, dna.decayed]);

  const next = nextFromPlan ?? dna.next;

  // "Mark this complete" / "Practice now" — ONE shared flow: a positive BKT
  // observation via updateMastery(). Graph colours, the next step and the
  // review list all re-derive from the refreshed state — no reload, no
  // navigation. Review completions deliberately never call replan().
  const markComplete = useMutation({
    mutationFn: async (vars: { nodeId: string; via: "next" | "review" }) =>
      runUpdateMastery({ data: { skill_node_id: vars.nodeId, correct: true } }),
    onSuccess: async (res, vars) => {
      const node = dna.allNodes.find((n) => n.id === res.skill_node_id);
      setCompletion({
        name: node?.name ?? "That skill",
        previous: res.previous_mastery,
        next: res.new_mastery,
        via: vars.via,
      });
      setCompletionVisible(true);
      if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
      fadeTimer.current = window.setTimeout(() => setCompletionVisible(false), 2000);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["learner-state", user?.id] }),
        queryClient.invalidateQueries({ queryKey: ["hidden-gaps", user?.id] }),
        queryClient.invalidateQueries({ queryKey: ["plan-snapshot", user?.id] }),
      ]);
    },
  });

  // Goal clarification: onboarding maps the typed goal to a supported track
  // only on a confident match; when it couldn't, goal_node_id is null and the
  // learner picks the closest track here. The typed text stays on the
  // profile — only the resolved node changes, then the plan regenerates.
  const clarifyGoal = useMutation({
    mutationFn: async (preset: GoalPreset) => {
      if (!user?.id) throw new Error("Not signed in");
      const node = dna.allNodes.find((n) => n.name === preset.nodeName);
      if (!node) throw new Error("That track isn't available yet.");
      await saveProfile(user.id, {
        goal_text: dna.profile?.goal_text ?? preset.label,
        goal_node_id: node.id,
      });
      await runReplan({}).catch(() => undefined);
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const runGenerateDomain = useServerFn(generateCustomDomain);

  // Custom-goal path: the typed goal matches no ready-made track, so we
  // generate (or reuse) a real skill graph for it and anchor the plan there.
  const generateCustom = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Not signed in");
      const goalText = dna.profile?.goal_text?.trim();
      if (!goalText) throw new Error("No goal text");
      const generated = await runGenerateDomain({ data: { goal_text: goalText } });
      await saveProfile(user.id, { goal_node_id: generated.capstone_node_id });
      await runReplan({}).catch(() => undefined);
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });

  // Up next: the skills queued right after the recommended one.
  const upcoming = useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; name: string; date: Date; minutes: number; mastery: number }[] = [];
    for (const entry of dna.plan) {
      if (entry.node.id === next?.id || seen.has(entry.node.id)) continue;
      seen.add(entry.node.id);
      list.push({
        id: entry.node.id,
        name: entry.node.name,
        date: entry.date,
        minutes: entry.minutes,
        mastery: entry.mastery,
      });
      if (list.length >= 5) break;
    }
    return list;
  }, [dna.plan, next?.id]);

  const heroFlash = completion?.via === "next" && completionVisible;

  return (
    <AppShell
      title={dna.profile?.display_name ? `Welcome back, ${dna.profile.display_name}` : "Your path"}
      subtitle={
        dna.goalNode
          ? `Working toward ${dna.goalNode.name}${
              dna.daysLeft === null
                ? ""
                : dna.daysLeft >= 0
                  ? ` · ${dna.daysLeft} days to your target date`
                  : " · your target date has passed"
            }`
          : "Tell us your goal and we'll shape the map around it."
      }
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            onClick={() => setInsightsSheetOpen(true)}
          >
            Insights
          </Button>
          <MagneticLink to="/diagnostic" variant="secondary" size="sm">
            Recalibrate
          </MagneticLink>
          <MagneticLink to="/plan" size="sm">
            Continue learning
          </MagneticLink>
        </div>
      }
    >
      {dna.error ? (
        <div className="mb-6">
          <ErrorState
            message="We couldn't load your path just now."
            onRetry={() => queryClient.invalidateQueries()}
          />
        </div>
      ) : null}

      {dna.profile && !dna.profile.goal_node_id ? (
        <Card className="mb-6 border-primary/40 px-5 py-4 sm:px-6">
          <p className="text-sm font-medium text-foreground">One quick clarification</p>
          <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
            “{dna.profile.goal_text ?? "Your goal"}” isn't one of the ready-made tracks. Build a
            dedicated skill map for exactly that goal with AI — or switch to the closest ready-made
            track.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {dna.profile.goal_text ? (
              <Button
                size="sm"
                disabled={generateCustom.isPending || clarifyGoal.isPending}
                onClick={() => generateCustom.mutate()}
              >
                {generateCustom.isPending
                  ? "Building your map…"
                  : "Build a custom map for this goal"}
              </Button>
            ) : null}
            {SUPPORTED_GOALS.map((preset) => (
              <Button
                key={preset.key}
                size="sm"
                variant="secondary"
                disabled={clarifyGoal.isPending || generateCustom.isPending}
                onClick={() => clarifyGoal.mutate(preset)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          {generateCustom.isError ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              We couldn't build that map just now — try again.
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* NEXT BEST STEP — the visual anchor of the page. Real data only;
          completion animates through processing → confirmed → mastery bumped. */}
      <section
        aria-label="Next best step"
        className={cn(
          "animate-enter relative overflow-hidden rounded-2xl border bg-card px-5 py-6 shadow-[var(--shadow-raised)] transition-[border-color,box-shadow] duration-500 sm:px-8 sm:py-7",
          "pm-spot",
          heroFlash ? "border-success/60" : "border-primary/30",
        )}
      >
        <div ref={heroCardTiltRef} className="relative">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-28 -top-28 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
          />
          {dna.loading ? (
            <div className="relative">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="mt-4 h-8 w-2/3" />
              <Skeleton className="mt-3 h-4 w-full max-w-xl" />
              <Skeleton className="mt-6 h-11 w-64" />
            </div>
          ) : next ? (
            <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-primary">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Start here next
                </p>
                <h2 className="mt-2.5 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  {next.name}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  {next.description}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">About {next.effort_hours} h</Badge>
                  <Badge tone="neutral">Ready now · {masteryLabel(dna.decayed.get(next.id))}</Badge>
                  <Badge tone={next.is_required ? "info" : "neutral"}>
                    {next.is_required ? "Needed for your goal" : "Nice to have"}
                  </Badge>
                  {dna.hiddenGapIds.has(next.id) ? (
                    <Badge tone="warning">Missing piece</Badge>
                  ) : null}
                </div>
                <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Why this one? </span>
                  {dna.hiddenGapIds.has(next.id)
                    ? "Your goal quietly depends on it, and we've never seen you cover it — so everything above it stays stuck."
                    : "You've already got what it builds on, and it opens up more of your path than anything else right now."}
                </p>
                {/* Advisory pace signal — display-only, never alters the plan. */}
                <p className="mt-2.5 text-xs text-muted-foreground">
                  {paceLine(dna.paceByNode.get(next.id) ?? "insufficient")}
                </p>
              </div>
              <div className="flex flex-col gap-2.5 lg:w-52 lg:shrink-0">
                <MagneticLink
                  to="/practice/$nodeId"
                  params={{ nodeId: next.id }}
                  className="w-full min-h-11"
                >
                  Practice now
                </MagneticLink>
                <MagneticButton
                  variant="secondary"
                  className="min-h-11 w-full"
                  onClick={() => markComplete.mutate({ nodeId: next.id, via: "next" })}
                  disabled={markComplete.isPending}
                >
                  {markComplete.isPending && markComplete.variables?.via === "next"
                    ? "Updating your map…"
                    : "Mark complete"}
                </MagneticButton>
                <Link to="/skill-dna" className="w-full">
                  <Button variant="ghost" className="min-h-11 w-full">
                    See it on the map
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="relative">
              <EmptyState
                title="Nothing queued yet"
                description="Answer a few short questions so we can find the right starting point for you."
                action={
                  <Link to="/diagnostic">
                    <Button size="sm">Get started</Button>
                  </Link>
                }
              />
            </div>
          )}

          {/* Inline, non-blocking BKT feedback — pops in, fades after ~2s. */}
          <div aria-live="polite" className="relative">
            {completion?.via === "next" ? (
              <div
                className={cn(
                  "mt-5 rounded-xl border border-success/40 bg-success-soft/40 px-4 py-3 transition-opacity duration-500",
                  completionVisible ? "animate-pop opacity-100" : "opacity-0",
                )}
              >
                <p className="text-sm text-foreground">Logged — nice work on {completion.name}.</p>
                <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="tabular-nums">
                    Mastery updated: {completion.previous.toFixed(2)} → {completion.next.toFixed(2)}
                  </span>
                  <InfoTip label="mastery" text={HELP_TEXT.mastery} />
                </p>
              </div>
            ) : null}
            {markComplete.isError && markComplete.variables?.via !== "review" ? (
              <p className="mt-4 text-sm text-destructive" role="alert">
                We couldn't log that just now — try again.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* Compact metric strip — one horizontal band, never four tall cards. */}
      <Card className="animate-enter mt-5 px-5 py-4 sm:px-6" aria-label="Progress overview">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
          <StripMetric
            label={
              <>
                Overall progress
                <InfoTip label="mastery" text={HELP_TEXT.mastery} />
              </>
            }
            loading={dna.loading}
          >
            <MasteryReadout value={dna.overall} size="sm" />
            <ProgressBar value={dna.overall * 100} className="mt-2 h-1" animateOnView />
          </StripMetric>
          <StripMetric label="Skills solid" loading={dna.loading}>
            <span className="text-base font-semibold tabular-nums text-foreground">
              {dna.solid} / {dna.nodes.length}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {Math.round(MASTERED * 100)}%+ today counts as solid
            </span>
          </StripMetric>
          <StripMetric
            label={
              <>
                Missing pieces
                <InfoTip label="hidden gap" text={HELP_TEXT.hiddenGap} />
              </>
            }
            loading={dna.gapsLoading}
          >
            <span className="text-base font-semibold tabular-nums text-foreground">
              {dna.hiddenGaps.length}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {dna.hiddenGaps.length ? "never tested, goal needs them" : "none blocking your goal"}
            </span>
          </StripMetric>
          <StripMetric label="Target date" loading={dna.loading}>
            <span className="text-base font-semibold tabular-nums text-foreground">
              {dna.daysLeft === null
                ? "Not set"
                : dna.daysLeft >= 0
                  ? `${dna.daysLeft} days`
                  : "Passed"}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {dna.daysLeft === null
                ? "set one in your constraints below"
                : dna.daysLeft >= 0
                  ? "left to hit your goal"
                  : "consider moving the finish line"}
            </span>
          </StripMetric>
        </dl>
      </Card>

      {/* Main region: roadmap (left, wide) + insights rail (right, narrow). */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
        <div className="grid min-w-0 content-start gap-6">
          {/* Up next — connected compact rows, detail stays on the plan page. */}
          <Card className="animate-enter" interactive>
            <CardHeader
              title="Up next on your plan"
              subtitle={dna.plan.length ? `${dna.plan.length} sessions scheduled` : undefined}
              action={
                <Link to="/plan">
                  <Button variant="ghost" size="sm">
                    Full plan
                  </Button>
                </Link>
              }
            />
            <div className="px-5 pb-4 pt-2 sm:px-6">
              {dna.loading ? (
                <div className="grid gap-2.5 py-1">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : upcoming.length ? (
                <ol className="relative">
                  {upcoming.map((item, i) => (
                    <li key={item.id} className="relative flex items-baseline gap-3 py-2.5">
                      {/* connected timeline spine */}
                      <span
                        aria-hidden="true"
                        className="relative flex w-3 shrink-0 justify-center self-stretch"
                      >
                        {i < upcoming.length - 1 ? (
                          <span className="absolute inset-y-0 w-px bg-border" />
                        ) : null}
                        <span className="relative mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {item.name}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {item.date.toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}{" "}
                        · {item.minutes} min · {masteryLabel(item.mastery)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="py-1 text-sm text-muted-foreground">
                  {next
                    ? "Just the one step left — you're nearly there."
                    : "Your upcoming sessions appear here once your plan is built."}
                </p>
              )}
            </div>
          </Card>

          {/* Spaced review — once-solid skills that have faded below 0.6 after
              decay. Read-time derivation only; "Practice now" is the exact same
              updateMastery() flow as "Mark complete" and never triggers a
              replan or a plan_history row. */}
          {!dna.loading && dna.reviewDue.length ? (
            <Card id="due-review" interactive>
              <CardHeader
                title="Due for review"
                subtitle="You had these down — they're starting to fade. A quick refresh brings them back."
              />
              <ul className="divide-y divide-border px-5 pb-2 pt-1 sm:px-6">
                {dna.reviewDue.map((item) => (
                  <li
                    key={item.nodeId}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {masterySentence(item.decayed)} — this one's faded since you last practiced
                        it.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="min-h-11"
                      onClick={() => markComplete.mutate({ nodeId: item.nodeId, via: "review" })}
                      disabled={markComplete.isPending}
                    >
                      {markComplete.isPending && markComplete.variables?.nodeId === item.nodeId
                        ? "Updating…"
                        : "Practice now"}
                    </Button>
                  </li>
                ))}
              </ul>
              <div aria-live="polite" className="px-5 pb-4 sm:px-6">
                {completion?.via === "review" ? (
                  <div
                    className={cn(
                      "rounded-xl border border-success/40 bg-success-soft/40 px-4 py-3 transition-opacity duration-500",
                      completionVisible ? "animate-pop opacity-100" : "opacity-0",
                    )}
                  >
                    <p className="text-sm text-foreground">
                      Logged — nice work on {completion.name}.
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="tabular-nums">
                        Mastery updated: {completion.previous.toFixed(2)} →{" "}
                        {completion.next.toFixed(2)}
                      </span>
                      <InfoTip label="mastery" text={HELP_TEXT.mastery} />
                    </p>
                  </div>
                ) : null}
                {markComplete.isError && markComplete.variables?.via === "review" ? (
                  <p className="text-sm text-destructive" role="alert">
                    We couldn't log that just now — try again.
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}

          {/* Constraints — compact two-field form, saving never navigates. */}
          <Card id="constraints" className="px-5 py-5 sm:px-6">
            <h2 className="text-base font-semibold text-foreground">Your constraints</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Change these any time — we'll rebuild the plan around them and keep you signed in.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-foreground" htmlFor="deadline">
                  When do you want to be ready?
                </label>
                <input
                  id="deadline"
                  type="date"
                  className={`${inputClass} mt-2`}
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground" htmlFor="minutes">
                  How much time can you realistically give this each day?
                </label>
                <input
                  id="minutes"
                  type="number"
                  min={0}
                  max={480}
                  step={5}
                  className={`${inputClass} mt-2`}
                  value={minutes}
                  aria-invalid={Boolean(minutesError)}
                  aria-describedby="minutes-hint"
                  onChange={(e) => {
                    setMinutes(e.target.value);
                    if (minutesError) setMinutesError(null);
                  }}
                />
                <p id="minutes-hint" className="mt-2 text-xs text-muted-foreground">
                  Minutes per day
                </p>
                {minutesError ? (
                  <p className="mt-2 text-sm text-destructive" role="alert">
                    {minutesError}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <Button onClick={handleSave} disabled={savePlan.isPending}>
                {savePlan.isPending ? "Rebuilding your plan…" : "Save"}
              </Button>
              {saved ? <span className="text-sm text-success">Saved</span> : null}
              {savePlan.isError ? (
                <span className="text-sm text-destructive">That didn't save — try again.</span>
              ) : null}
            </div>
          </Card>

          {result ? <ReplanPanel result={result} onAcceptDate={acceptSuggestedDate} /> : null}
        </div>

        {/* Insights rail — desktop: collapsible sticky rail. */}
        <div className="hidden lg:block">
          {railOpen ? (
            <Card className="sticky top-20 px-5 py-5" aria-label="Insights">
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Insights
                </p>
                <button
                  type="button"
                  onClick={() => setRailOpen(false)}
                  aria-label="Collapse insights"
                  className="grid h-7 w-7 place-items-center rounded-md text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  »
                </button>
              </div>
              <InsightsRail
                next={next}
                nodes={dna.nodes}
                edges={dna.edges}
                decayed={dna.decayed}
                goalNode={dna.goalNode ?? null}
                hiddenGapIds={dna.hiddenGapIds}
                hiddenGaps={dna.hiddenGaps}
                reviewDue={dna.reviewDue}
                dailyMinutes={dna.profile?.daily_time_minutes ?? 45}
                deadline={dna.profile?.deadline_date ?? null}
                daysLeft={dna.daysLeft}
                history={history.rows}
                historyLoading={history.loading}
                loading={dna.loading}
              />
            </Card>
          ) : (
            <button
              type="button"
              onClick={() => setRailOpen(true)}
              aria-label="Expand insights"
              className="sticky top-20 grid h-24 w-8 place-items-center rounded-xl border border-border bg-card text-xs text-muted-foreground shadow-[var(--shadow-card)] transition-colors hover:bg-secondary hover:text-foreground"
            >
              <span aria-hidden="true" className="rotate-90 whitespace-nowrap">
                « Insights
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile/tablet: insights as a bottom sheet (same component). */}
      {insightsSheetOpen ? (
        <BottomSheet title="Insights" onClose={() => setInsightsSheetOpen(false)}>
          <InsightsRail
            next={next}
            nodes={dna.nodes}
            edges={dna.edges}
            decayed={dna.decayed}
            goalNode={dna.goalNode ?? null}
            hiddenGapIds={dna.hiddenGapIds}
            hiddenGaps={dna.hiddenGaps}
            reviewDue={dna.reviewDue}
            dailyMinutes={dna.profile?.daily_time_minutes ?? 45}
            deadline={dna.profile?.deadline_date ?? null}
            daysLeft={dna.daysLeft}
            history={history.rows}
            historyLoading={history.loading}
            loading={dna.loading}
          />
        </BottomSheet>
      ) : null}

      {/* Mobile: the recommendation rides along at the bottom. */}
      {next ? (
        <div className="sticky bottom-0 z-30 -mx-4 mt-6 border-t border-border bg-card/95 px-4 py-4 backdrop-blur lg:hidden">
          <div className="flex items-center gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium text-primary">Start here next</p>
              <p className="truncate text-sm font-semibold text-foreground">{next.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {masteryLabel(dna.decayed.get(next.id))}
              </p>
            </div>
            <Link to="/plan" className="ml-auto shrink-0">
              <Button size="sm" className="min-h-11">
                Start
              </Button>
            </Link>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

function StripMetric({
  label,
  loading,
  children,
}: {
  label: ReactNode;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1.5">{loading ? <Skeleton className="h-5 w-20" /> : children}</dd>
    </div>
  );
}

type ReplanResult = Awaited<ReturnType<typeof replan>>;

function prettyDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

/**
 * The single most important read on this page: what just changed in the plan
 * and why. Inline and non-blocking — never a modal.
 */
function ReplanPanel({
  result,
  onAcceptDate,
}: {
  result: ReplanResult;
  onAcceptDate: (date: string) => void;
}) {
  if (!result.valid) {
    return (
      <Card className="border-warning/40 px-5 py-5 sm:px-6">
        <Badge tone="warning">Plan not rebuilt</Badge>
        <p className="mt-3 text-sm text-foreground">
          {result.reason === "goal_needed"
            ? "Pick a goal first and we'll build the roadmap around it."
            : "Add a little daily time so we can build you a real plan."}
        </p>
      </Card>
    );
  }

  const { diff, dropped } = result;
  const nothingChanged = diff.added.length === 0 && diff.removed.length === 0 && !diff.reordered;

  return (
    <Card className="animate-pop border-primary/40 px-5 py-5 sm:px-6" as="section">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">Plan updated</Badge>
        {result.micro_chunking ? <Badge tone="neutral">Short daily sessions</Badge> : null}
      </div>

      {result.deadline_overdue && result.suggested_new_deadline_date ? (
        <div className="mt-4">
          <p className="text-sm font-medium text-foreground">
            That date's already passed — here's a more realistic one:{" "}
            {prettyDate(result.suggested_new_deadline_date)}.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing's lost. We kept every required skill and just re-paced the finish line.
          </p>
          <Button
            size="sm"
            className="mt-4 min-h-11"
            onClick={() => onAcceptDate(result.suggested_new_deadline_date!)}
          >
            Use {prettyDate(result.suggested_new_deadline_date)}
          </Button>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {dropped.length ? (
            <p className="text-sm text-foreground">
              <span className="font-medium">Removed: </span>
              {dropped.join(", ")} — {dropped.length === 1 ? "it's" : "they're"} optional and lower
              priority right now, so we're focusing your time elsewhere.
            </p>
          ) : null}
          {diff.added.length ? (
            <p className="text-sm text-foreground">
              <span className="font-medium">Added: </span>
              {diff.added.join(", ")}
            </p>
          ) : null}
          {diff.reordered ? (
            <p className="text-sm text-foreground">
              We reordered the remaining steps so prerequisites come first.
            </p>
          ) : null}
          {nothingChanged && !dropped.length ? (
            <p className="text-sm text-foreground">
              We re-checked everything — your plan still fits, so nothing moved.
            </p>
          ) : null}
          {result.suggested_new_deadline_date ? (
            <div>
              <p className="text-sm text-foreground">
                New estimated finish: {prettyDate(result.suggested_new_deadline_date)}.
              </p>
              <Button
                size="sm"
                className="mt-3 min-h-11"
                onClick={() => onAcceptDate(result.suggested_new_deadline_date!)}
              >
                Move my target date
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <p className="mt-4 text-sm text-muted-foreground">
        {result.total_effort_hours} h of work left
        {result.deadline_overdue
          ? " · your target date has already passed"
          : result.available_hours === null
            ? " · no target date set yet"
            : ` · about ${result.available_hours} h available before your target date`}
        .
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{result.reasoning}</p>
    </Card>
  );
}
