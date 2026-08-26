import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { replan } from "@/lib/replan.functions";
import { applyCompletedCourseCredit } from "@/lib/skilldna.functions";

import { AppHeader } from "@/components/AppHeader";
import { LearningUniverse } from "@/components/LearningUniverse";
import {
  Badge,
  Button,
  Card,
  Field,
  ProgressBar,
  Skeleton,
  inputClass,
} from "@/components/Primitives";
import { SKILL_LEVELS, type SkillLevel } from "@/lib/calibration";
import { generateCustomDomain, type GeneratedDomain } from "@/lib/domains.functions";
import {
  DEFAULT_GOAL_TEXT,
  SUPPORTED_GOALS,
  resolveGoalNodeId,
  resolveGoalPreset,
} from "@/lib/goals";
import { courseMatchesNode } from "@/lib/matching";
import {
  COURSE_CATALOG,
  DOMAIN,
  LEARNING_STYLES,
  SUBJECT_OPTIONS,
  fetchProfile,
  saveProfile,
} from "@/lib/pathmind";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PathMind — A personalized learning path for any goal" },
      {
        name: "description",
        content:
          "Tell PathMind any goal — a career, a technology, a subject — and get an adaptive skill graph, a short calibration and a plan that tells you exactly what to learn next.",
      },
      { property: "og:title", content: "PathMind — Your personalized learning path" },
      {
        property: "og:description",
        content:
          "Tell PathMind your goal, take a short adaptive calibration, and get a skill graph that shows your next step.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const PENDING_KEY = "pathmind:pending-onboarding";

type Draft = {
  displayName: string;
  skillLevel: SkillLevel;
  goalText: string;
  courses: string[];
  subjects: string[];
  minutes: string;
  deadline: string;
  learningStyle: string;
};

const EMPTY_DRAFT: Draft = {
  displayName: "",
  skillLevel: "beginner",
  goalText: "",
  courses: [],
  subjects: [],
  minutes: "60",
  deadline: "",
  learningStyle: "mixed",
};

const STEPS = [
  { key: "about", title: "About you", blurb: "So the plan sounds like it's yours." },
  { key: "goals", title: "Your goal", blurb: "Where you want this path to land." },
  { key: "subjects", title: "Subjects", blurb: "Topics you want to prioritise." },
  { key: "schedule", title: "Time & target date", blurb: "How fast we can realistically move." },
  { key: "prefs", title: "Preferences", blurb: "How you like to learn." },
  { key: "review", title: "Calibration", blurb: "A short adaptive check, then your graph." },
] as const;

const HERO_FEATURES: { title: string; description: string }[] = [
  { title: "Adaptive check-in", description: "Harder when you're ready, never repetitive." },
  {
    title: "Living skill map",
    description: "Your learning path updates as your knowledge changes.",
  },
  {
    title: "Hidden prerequisite detection",
    description: "Discover missing foundations before they block your goal.",
  },
];

async function persistDraft(
  draft: Draft,
  userId: string,
  generateDomain: (goalText: string) => Promise<GeneratedDomain>,
) {
  const goalText = draft.goalText.trim() || DEFAULT_GOAL_TEXT;
  // Goal resolution (src/lib/goals.ts): the typed goal is matched against
  // the ready-made tracks anchored to the seeded graph. Exactly one
  // confident match → its node id. Anything else is a CUSTOM goal: a real
  // skill graph is generated (or reused) for it — we never silently force
  // the learner onto the Java track.
  const { data: templateNodes } = await supabase
    .from("skill_nodes")
    .select("id, name")
    .eq("domain", DOMAIN);
  let goalNodeId = resolveGoalNodeId(goalText, templateNodes ?? []);
  let creditedNames = COURSE_CATALOG.filter((c) => draft.courses.includes(c.label)).flatMap(
    (c) => c.nodes,
  );

  if (!goalNodeId) {
    const generated = await generateDomain(goalText);
    goalNodeId = generated.capstone_node_id;
    // Free-text prior courses are matched conservatively against the custom
    // map's own node names (same matcher the Java track uses).
    creditedNames = generated.nodes
      .filter((n) => draft.courses.some((course) => courseMatchesNode(course, n.name)))
      .map((n) => n.name);
  }

  await saveProfile(userId, {
    display_name: draft.displayName.trim() || null,
    skill_level: draft.skillLevel,
    goal_node_id: goalNodeId,
    goal_text: goalText,
    daily_time_minutes: Number(draft.minutes) || 30,
    deadline_date: draft.deadline || null,
    completed_courses: draft.courses,
    subjects: draft.subjects,
    learning_style: draft.learningStyle,
  });

  if (creditedNames.length > 0) {
    // Server-side, explicit and auditable: prior-knowledge credit, written
    // only for skills with no measured state yet.
    await applyCompletedCourseCredit({
      data: { node_names: creditedNames, courses: draft.courses },
    });
  }
}

function Landing() {
  const navigate = useNavigate();
  const { session, initializing } = useAuth();
  const userId = session?.user.id;
  const runReplan = useServerFn(replan);
  const runGenerateDomain = useServerFn(generateCustomDomain);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    enabled: Boolean(userId),
    queryFn: () => fetchProfile(userId!),
  });

  // Restore any draft captured before sign-in, then hydrate from saved profile.
  useEffect(() => {
    if (typeof window === "undefined" || hydrated) return;
    if (initializing) return;
    if (userId && profileQuery.isPending) return;

    let next = { ...EMPTY_DRAFT };
    const profile = profileQuery.data;
    if (profile) {
      next = {
        displayName: profile.display_name ?? "",
        skillLevel: (profile.skill_level as SkillLevel) ?? "beginner",
        goalText: profile.goal_text ?? "",
        courses: profile.completed_courses ?? [],
        subjects: profile.subjects ?? [],
        minutes: String(profile.daily_time_minutes ?? 60),
        deadline: profile.deadline_date ?? "",
        learningStyle: profile.learning_style ?? "mixed",
      };
    }
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (raw) {
      try {
        next = { ...next, ...(JSON.parse(raw) as Draft) };
      } catch {
        /* ignore malformed draft */
      }
    }
    setDraft(next);
    setHydrated(true);
  }, [initializing, userId, profileQuery.isPending, profileQuery.data, hydrated]);

  // Signed in with a pending pre-auth draft → save it and continue.
  useEffect(() => {
    if (!hydrated || !userId || typeof window === "undefined") return;
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_KEY);
    (async () => {
      try {
        await persistDraft(JSON.parse(raw) as Draft, userId, (text) =>
          runGenerateDomain({ data: { goal_text: text } }),
        );
        // Initial roadmap right after onboarding — never blocks navigation.
        await runReplan({}).catch(() => undefined);
        navigate({ to: "/diagnostic" });
      } catch {
        setError("We couldn't save your setup. Please review it below and continue.");
      }
    })();
  }, [hydrated, userId, navigate, runReplan, runGenerateDomain]);


  const patch = (values: Partial<Draft>) => setDraft((d) => ({ ...d, ...values }));

  const progress = useMemo(() => ((step + 1) / STEPS.length) * 100, [step]);

  // Live goal resolution feedback: exactly one confident track match, or the
  // learner is asked to pick — we never silently default to the capstone.
  const goalTextTrimmed = draft.goalText.trim();
  const goalPreset = useMemo(
    () => resolveGoalPreset(goalTextTrimmed || DEFAULT_GOAL_TEXT),
    [goalTextTrimmed],
  );
  // A typed goal that matches no ready-made track is a custom goal — PathMind
  // generates a dedicated skill map for it at finish time.
  const isCustomGoal = goalTextTrimmed.length > 0 && !goalPreset;

  async function finish() {
    setError(null);
    if (!userId) {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(draft));
      navigate({ to: "/auth" });
      return;
    }
    setBusy(true);
    setBusyLabel(isCustomGoal ? "Building your skill map with AI…" : null);
    try {
      await persistDraft(draft, userId, (text) =>
        runGenerateDomain({ data: { goal_text: text } }),
      );
      await runReplan({}).catch(() => undefined);
      navigate({ to: "/diagnostic" });

    } catch {
      setError("Something went wrong while saving. Your answers are still here — try again.");
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }

  const showSkeleton = initializing || (Boolean(userId) && profileQuery.isPending);

  return (
    <div className="min-h-dvh bg-background">
      <AppHeader />

      <main>
        <section className="relative flex min-h-[calc(100svh-3.5rem)] items-center overflow-hidden">
          {/* Ambient backdrop: faint engineering grid + indigo glows. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="lu-grid-bg absolute inset-0" />
            <div className="lu-hero-glow absolute right-[-12%] top-[-22%] h-[42rem] w-[42rem] rounded-full" />
            <div className="lu-hero-glow lu-hero-glow--soft absolute bottom-[-32%] left-[-14%] h-[36rem] w-[36rem] rounded-full" />
          </div>

          <div className="relative mx-auto grid w-full max-w-7xl items-center gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] lg:gap-4 lg:px-8 lg:py-8">
            <div>
              <div className="animate-enter">
                <Badge tone="primary" className="uppercase tracking-[0.18em]">
                  Adaptive skill-graph learning
                </Badge>
              </div>
              <h1
                className="animate-enter mt-6 max-w-[13ch] text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl xl:text-7xl"
                style={{ animationDelay: "80ms" }}
              >
                Stop guessing what to{" "}
                <span className="pm-hero-gradient bg-clip-text text-transparent">
                  learn next.
                </span>
              </h1>
              <p
                className="animate-enter mt-5 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg"
                style={{ animationDelay: "160ms" }}
              >
                PathMind builds a skill graph between where you are today and where you want to
                be, then keeps recommending the single next step that actually moves you forward.
              </p>
              <div
                className="animate-enter mt-8 flex flex-wrap items-center gap-3"
                style={{ animationDelay: "220ms" }}
              >
                <Button
                  size="lg"
                  onClick={() =>
                    document
                      .getElementById("onboarding")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                >
                  Start your path
                </Button>
                {session ? (
                  <Link to="/dashboard">
                    <Button variant="secondary" size="lg">
                      Go to dashboard
                    </Button>
                  </Link>
                ) : (
                  <Link to="/auth">
                    <Button variant="ghost" size="lg">
                      Sign in
                    </Button>
                  </Link>
                )}
              </div>
              <ul className="mt-10 space-y-5">
                {HERO_FEATURES.map((feature, i) => (
                  <li
                    key={feature.title}
                    className="animate-enter flex gap-3.5"
                    style={{ animationDelay: `${300 + i * 90}ms` }}
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{feature.title}</p>
                      <p className="mt-0.5 max-w-md text-sm leading-relaxed text-muted-foreground">
                        {feature.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <LearningUniverse className="h-[340px] sm:h-[440px] lg:h-[560px]" />
          </div>

          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-5 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-1 text-muted-foreground sm:flex"
          >
            <span className="text-[10px] font-medium uppercase tracking-[0.22em]">Scroll</span>
            <ChevronDown className="h-4 w-4 animate-bounce" />
          </div>
        </section>

        <section
          id="onboarding"
          className="mx-auto w-full max-w-3xl scroll-mt-20 px-4 pb-16 sm:px-6 lg:px-8"
        >
          <Card className="overflow-hidden">
            <div className="border-b border-border px-5 py-4 sm:px-7">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-primary">
                Step {step + 1} of {STEPS.length}
              </p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <h2 className="text-lg font-semibold text-foreground">{STEPS[step]!.title}</h2>
                <p className="text-sm text-muted-foreground">{STEPS[step]!.blurb}</p>
              </div>
              <ProgressBar value={progress} className="mt-3 h-1.5" />
              <ol className="mt-3 hidden flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] sm:flex">
                {STEPS.map((s, i) => (
                  <li key={s.key} className="flex items-center gap-x-1.5">
                    {i > 0 ? (
                      <span aria-hidden="true" className="text-muted-foreground/40">
                        →
                      </span>
                    ) : null}
                    <span
                      className={
                        i === step
                          ? "font-medium text-foreground"
                          : i < step
                            ? "text-success"
                            : "text-muted-foreground/60"
                      }
                    >
                      {i < step ? "✓ " : ""}
                      {s.title}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="px-5 py-5 sm:px-7 sm:py-6">
              {showSkeleton ? (
                <div className="space-y-4">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-11 w-full" />
                  <Skeleton className="h-11 w-full" />
                  <Skeleton className="h-11 w-2/3" />
                </div>
              ) : (
                <>
                  {step === 0 ? (
                    <div className="space-y-5">
                      <Field label="What should we call you?" htmlFor="name">
                        <input
                          id="name"
                          value={draft.displayName}
                          onChange={(e) => patch({ displayName: e.target.value })}
                          placeholder="Alex"
                          maxLength={60}
                          className={inputClass}
                        />
                      </Field>
                      <Field
                        label="How would you rate yourself today?"
                        hint="We use this to pitch the first few questions at the right level."
                      >
                        <div
                          className="grid gap-2 sm:grid-cols-3"
                          role="group"
                          aria-label="Experience level"
                        >
                          {SKILL_LEVELS.map((level) => {
                            const active = draft.skillLevel === level.value;
                            return (
                              <button
                                key={level.value}
                                type="button"
                                aria-pressed={active}
                                onClick={() => patch({ skillLevel: level.value })}
                                className={`rounded-xl border px-3.5 py-3 text-left transition-all ${
                                  active
                                    ? "border-primary bg-primary-soft ring-2 ring-primary/25"
                                    : "border-border bg-card hover:border-border-strong"
                                }`}
                              >
                                <span className="block text-sm font-medium text-foreground">
                                  {level.label}
                                </span>
                                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                                  {level.hint}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </Field>
                    </div>
                  ) : null}

                  {step === 1 ? (
                    <div className="space-y-5">
                      <Field
                        label="What do you want to become or learn?"
                        htmlFor="goal"
                        hint="Any goal works — a career, a technology, a subject. We'll match a ready-made track or build a custom skill map with AI."
                      >
                        <textarea
                          id="goal"
                          rows={2}
                          value={draft.goalText}
                          onChange={(e) => patch({ goalText: e.target.value })}
                          placeholder="e.g. Become an AI Engineer, Learn Cybersecurity, Master UI/UX Design"
                          maxLength={200}
                          className={`${inputClass} resize-none`}
                        />
                      </Field>
                      {goalPreset ? (
                        <p className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success [overflow-wrap:anywhere]">
                          Matched track: <span className="font-medium">{goalPreset.label}</span> —{" "}
                          {goalPreset.blurb}
                        </p>
                      ) : isCustomGoal ? (
                        <div className="rounded-xl border border-primary/40 bg-primary-soft p-4">
                          <p className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">
                            A custom path for “{goalTextTrimmed}”
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            When you finish, PathMind generates a dedicated skill map and
                            calibration for this exact goal — no pre-set track needed.
                          </p>
                        </div>
                      ) : null}
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Or start from a ready-made track
                        </p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {SUPPORTED_GOALS.map((preset) => (
                            <button
                              key={preset.key}
                              type="button"
                              onClick={() => patch({ goalText: preset.label })}
                              className="rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm transition-all hover:border-primary"
                            >
                              <span className="block font-medium text-foreground">
                                {preset.label}
                              </span>
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {preset.blurb}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                      {isCustomGoal ? (
                        <Field
                          label="Courses or material you've already completed"
                          hint="Free text — matched against your custom skill map as a head start. Add one at a time or paste several separated by commas."
                        >
                          <FreeTextCourses
                            courses={draft.courses}
                            onChange={(courses) => patch({ courses })}
                          />
                        </Field>
                      ) : (
                        <Field
                          label="Courses you've already completed"
                          hint="We'll treat these as a head start, then check the rest with a few questions."
                        >
                          <div className="grid gap-2 sm:grid-cols-2">
                            {COURSE_CATALOG.map((course) => (
                              <Toggle
                                key={course.label}
                                label={course.label}
                                checked={draft.courses.includes(course.label)}
                                onChange={() =>
                                  patch({
                                    courses: draft.courses.includes(course.label)
                                      ? draft.courses.filter((c) => c !== course.label)
                                      : [...draft.courses, course.label],
                                  })
                                }
                              />
                            ))}
                          </div>
                        </Field>
                      )}
                    </div>
                  ) : null}

                  {step === 2 ? (
                    isCustomGoal ? (
                      <div className="rounded-xl border border-border bg-surface-raised p-4">
                        <p className="text-sm font-medium text-foreground">
                          Your custom map sets the focus
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Calibration will probe the core areas of the skill map we build for your
                          goal — broad first, then sharper where it matters.
                        </p>
                      </div>
                    ) : (
                      <Field
                        label="Which subjects matter most right now?"
                        hint="Pick a few and we'll focus your questions there. Leave it empty for a broad check."
                      >
                        <div className="flex flex-wrap gap-2">
                          {SUBJECT_OPTIONS.map((subject) => {
                            const active = draft.subjects.includes(subject);
                            return (
                              <button
                                key={subject}
                                type="button"
                                onClick={() =>
                                  patch({
                                    subjects: active
                                      ? draft.subjects.filter((s) => s !== subject)
                                      : [...draft.subjects, subject],
                                  })
                                }
                                className={`rounded-full border px-4 py-2 text-xs font-medium transition-all ${
                                  active
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground"
                                }`}
                              >
                                {subject}
                              </button>
                            );
                          })}
                        </div>
                      </Field>
                    )
                  ) : null}

                  {step === 3 ? (
                    <div className="grid gap-6 sm:grid-cols-2">
                      <Field label="How much time can you give this each day?" htmlFor="minutes">
                        <div className="flex items-center gap-3">
                          <input
                            id="minutes"
                            type="number"
                            min={10}
                            max={600}
                            step={5}
                            value={draft.minutes}
                            onChange={(e) => patch({ minutes: e.target.value })}
                            className={`${inputClass} w-32`}
                          />
                          <span className="text-sm text-muted-foreground">minutes</span>
                        </div>
                      </Field>
                      <Field label="When would you like to be ready?" htmlFor="deadline" hint="Optional.">
                        <input
                          id="deadline"
                          type="date"
                          value={draft.deadline}
                          onChange={(e) => patch({ deadline: e.target.value })}
                          className={inputClass}
                        />
                      </Field>
                    </div>
                  ) : null}

                  {step === 4 ? (
                    <Field label="How do you learn best?">
                      <div
                        className="grid gap-2 sm:grid-cols-2"
                        role="group"
                        aria-label="Learning style"
                      >
                        {LEARNING_STYLES.map((style) => {
                          const active = draft.learningStyle === style.value;
                          return (
                            <button
                              key={style.value}
                              type="button"
                              aria-pressed={active}
                              onClick={() => patch({ learningStyle: style.value })}
                              className={`rounded-xl border px-3.5 py-3 text-left transition-all ${
                                active
                                  ? "border-primary bg-primary-soft ring-2 ring-primary/25"
                                  : "border-border bg-card hover:border-border-strong"
                              }`}
                            >
                              <span className="block text-sm font-medium text-foreground">
                                {style.label}
                              </span>
                              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                                {style.hint}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </Field>
                  ) : null}

                  {step === 5 ? (
                    <div className="space-y-4">
                      <div className="rounded-xl bg-surface-raised p-4">
                        <dl className="grid gap-3 text-sm sm:grid-cols-2">
                          <Summary label="Name" value={draft.displayName || "—"} />
                          <Summary label="Level" value={draft.skillLevel} />
                          <Summary label="Goal" value={draft.goalText || DEFAULT_GOAL_TEXT} />
                          <Summary label="Daily time" value={`${draft.minutes} min`} />
                          <Summary label="Target date" value={draft.deadline || "No deadline"} />
                          <Summary
                            label="Subjects"
                            value={
                              draft.subjects.length ? `${draft.subjects.length} selected` : "All"
                            }
                          />
                        </dl>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Next: 8 adaptive questions. They get harder when you're right and easier
                        when you're not, and you'll never see the same question twice.
                      </p>
                    </div>
                  ) : null}
                </>
              )}

              {error ? (
                <p className="mt-5 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="mt-6 flex items-center justify-between gap-3">
                <Button
                  variant="ghost"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  disabled={step === 0 || busy}
                >
                  Back
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button onClick={() => setStep((s) => s + 1)} disabled={showSkeleton}>
                    Continue
                  </Button>
                ) : (
                  <Button size="lg" onClick={finish} disabled={busy}>
                    {busy
                      ? (busyLabel ?? "Saving…")
                      : userId
                        ? "Start calibration"
                        : "Sign in and continue"}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </section>
      </main>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-all ${
        checked
          ? "border-primary bg-primary-soft text-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      <input type="checkbox" className="sr-only" checked={checked} onChange={onChange} />
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border text-[10px] ${
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border-strong bg-card"
        }`}
      >
        {checked ? "✓" : ""}
      </span>
      {label}
    </label>
  );
}

/** Free-text prior courses for custom goals — comma-separated or one at a time. */
function FreeTextCourses({
  courses,
  onChange,
}: {
  courses: string[];
  onChange: (next: string[]) => void;
}) {
  const [value, setValue] = useState("");
  const add = () => {
    const parts = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...courses];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setValue("");
  };
  return (
    <div>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="e.g. Google Data Analytics Certificate"
          maxLength={120}
          className={inputClass}
        />
        <Button type="button" variant="secondary" onClick={add} disabled={!value.trim()}>
          Add
        </Button>
      </div>
      {courses.length ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {courses.map((course) => (
            <li
              key={course}
              className="flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground"
            >
              <span className="[overflow-wrap:anywhere]">{course}</span>
              <button
                type="button"
                aria-label={`Remove ${course}`}
                onClick={() => onChange(courses.filter((c) => c !== course))}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium capitalize text-foreground [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}
