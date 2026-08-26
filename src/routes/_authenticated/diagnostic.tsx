import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { updateMastery } from "@/lib/skilldna.functions";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  InfoTip,
  ProgressBar,
  Skeleton,
} from "@/components/Primitives";
import { HELP_TEXT } from "@/lib/mastery";
import {
  CALIBRATION_LENGTH,
  START_DIFFICULTY,
  completeCalibrationSession,
  fetchSeenItemIds,
  getResumableSession,
  loadItemPool,
  nextTargetDifficulty,
  pickNextItem,
  startCalibrationSession,
  type CalibrationSummary,
  type SkillLevel,
} from "@/lib/calibration";
import { DOMAIN, PROBE_NODES, fetchProfile, type DiagnosticItem } from "@/lib/pathmind";

export const Route = createFileRoute("/_authenticated/diagnostic")({
  head: () => ({
    meta: [
      { title: "Calibration — PathMind" },
      {
        name: "description",
        content:
          "A short adaptive calibration that tunes your mastery estimates before PathMind builds your learning path.",
      },
      { property: "og:title", content: "Calibration — PathMind" },
      {
        property: "og:description",
        content: "Answer a handful of adaptive questions so PathMind knows where to start you.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Calibration,
});

type Phase = "loading" | "asking" | "saving" | "feedback" | "done" | "error";

type Feedback = {
  correct: boolean;
  topic: string;
  previous: number;
  next: number;
};

function Calibration() {
  const navigate = useNavigate();
  const { user, initializing } = useAuth();
  const runUpdateMastery = useServerFn(updateMastery);

  const [phase, setPhase] = useState<Phase>("loading");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [current, setCurrent] = useState<DiagnosticItem | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [answered, setAnswered] = useState(0);
  const [summary, setSummary] = useState<CalibrationSummary | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const fadeTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
  }, []);

  const pool = useRef<DiagnosticItem[]>([]);
  const nodeNames = useRef<Map<string, string>>(new Map());
  const usedInSession = useRef<Set<string>>(new Set());
  const seenBefore = useRef<Set<string>>(new Set());
  const askedPerNode = useRef<Map<string, number>>(new Map());
  const targetDifficulty = useRef(0.4);
  const results = useRef<{ nodeId: string; correct: boolean }[]>([]);

  const advance = useCallback(() => {
    const next = pickNextItem({
      pool: pool.current,
      usedInSession: usedInSession.current,
      seenBefore: seenBefore.current,
      askedPerNode: askedPerNode.current,
      targetDifficulty: targetDifficulty.current,
    });
    setCurrent(next);
    return next;
  }, []);

  /**
   * Builds the summary from everything answered so far, marks the session
   * complete and shows the results screen. Shared by the normal finish path
   * and the "resumed an already-finished session" path.
   */
  const finishSession = useCallback(
    async (userId: string, sid: string) => {
      setFinishing(true);
      const perNodeMap = new Map<string, { correct: number; total: number }>();
      for (const r of results.current) {
        const entry = perNodeMap.get(r.nodeId) ?? { correct: 0, total: 0 };
        entry.total += 1;
        if (r.correct) entry.correct += 1;
        perNodeMap.set(r.nodeId, entry);
      }
      const perNode = [...perNodeMap.entries()].map(([nodeId, v]) => ({
        nodeId,
        name: nodeNames.current.get(nodeId) ?? "Skill",
        ...v,
      }));
      const built: CalibrationSummary = {
        correct: results.current.filter((r) => r.correct).length,
        total: results.current.length,
        strengths: perNode.filter((n) => n.correct / n.total >= 0.6).map((n) => n.name),
        improvements: perNode.filter((n) => n.correct / n.total < 0.6).map((n) => n.name),
        perNode,
      };
      setSummary(built);
      try {
        await completeCalibrationSession({
          userId,
          sessionId: sid,
          itemIds: [...usedInSession.current],
          summary: built,
        });
      } catch {
        /* summary is still shown; mastery was already saved per answer */
      }
      setFinishing(false);
      setPhase("done");
    },
    [],
  );

  // Resume an active session if one exists (refresh / lost tab), otherwise
  // start a fresh, uniquely tracked one. Exactly one session is active at a
  // time; stale sessions are expired server-side reads.
  useEffect(() => {
    if (initializing || !user) return;
    let active = true;

    (async () => {
      try {
        const profile = await fetchProfile(user.id);
        const level = (profile?.skill_level as SkillLevel) ?? "beginner";
        targetDifficulty.current = START_DIFFICULTY[level] ?? 0.4;

        // The calibration domain follows the learner's persisted goal — the
        // seeded Java template only when that is genuinely their track, a
        // generated custom domain otherwise. Never assumed, never hardcoded.
        let domain = DOMAIN;
        if (profile?.goal_node_id) {
          const { data: goalNode } = await supabase
            .from("skill_nodes")
            .select("domain")
            .eq("id", profile.goal_node_id)
            .maybeSingle();
          if (goalNode?.domain) domain = goalNode.domain;
        }

        const { data: domainNodes } = await supabase
          .from("skill_nodes")
          .select("id, name")
          .eq("domain", domain);
        const all = domainNodes ?? [];
        if (!all.length) throw new Error("no nodes");
        nodeNames.current = new Map(all.map((n) => [n.id, n.name]));

        // Focus: the learner's chosen subjects when they exist in this
        // domain; the template's probe set for the seeded track; the whole
        // graph for generated domains (round-robin keeps coverage broad).
        const subjectFocus = (profile?.subjects ?? []).filter((s) =>
          all.some((n) => n.name === s),
        );
        const focusNames = subjectFocus.length
          ? subjectFocus
          : domain === DOMAIN
            ? PROBE_NODES
            : all.map((n) => n.name);
        let resolved = all.filter((n) => focusNames.includes(n.name));
        if (!resolved.length) resolved = all;

        let [items, seen, resumable] = await Promise.all([
          loadItemPool(resolved.map((n) => n.id)),
          fetchSeenItemIds(user.id),
          getResumableSession(user.id),
        ]);

        // Small/focused pools starve the adaptive rotation — widen to the
        // whole domain before giving up.
        if (items.length < CALIBRATION_LENGTH && resolved.length < all.length) {
          items = await loadItemPool(all.map((n) => n.id));
        }

        if (!active) return;
        pool.current = items;
        seenBefore.current = seen;

        let sid: string;
        if (resumable) {
          sid = resumable.sessionId;
          // Rehydrate progress in answer order so rotation, difficulty
          // adaptation and the question counter all continue where they left
          // off. Already-answered items can never reappear.
          for (const r of resumable.responses) {
            if (r.item_id) usedInSession.current.add(r.item_id);
            askedPerNode.current.set(
              r.skill_node_id,
              (askedPerNode.current.get(r.skill_node_id) ?? 0) + 1,
            );
            results.current.push({ nodeId: r.skill_node_id, correct: r.correct });
            targetDifficulty.current = nextTargetDifficulty(targetDifficulty.current, r.correct);
          }
          if (resumable.responses.length > 0) setAnswered(resumable.responses.length);
        } else {
          sid = await startCalibrationSession(user.id);
        }

        if (!active) return;
        setSessionId(sid);

        if (results.current.length >= CALIBRATION_LENGTH) {
          // Everything was already answered before the interruption.
          await finishSession(user.id, sid);
          return;
        }

        const nextItem = advance();
        if (!nextItem) {
          if (results.current.length > 0) {
            await finishSession(user.id, sid);
            return;
          }
          setPhase("error");
          return;
        }
        setPhase("asking");
      } catch {
        if (active) setPhase("error");
      }
    })();

    return () => {
      active = false;
    };
  }, [initializing, user, advance, finishSession]);

  async function submitAnswer() {
    if (!current || !user || !sessionId || selected === null) return;
    setPhase("saving");
    const correct = selected === current.correct_option_id;
    const item = current;

    let result: { previous_mastery: number; new_mastery: number };
    try {
      // Skill DNA engine: Bayesian Knowledge Tracing runs server-side and
      // returns the before/after mastery so we can show it inline.
      result = await runUpdateMastery({
        data: {
          skill_node_id: item.skill_node_id,
          correct,
          item_id: item.id,
          session_id: sessionId,
          selected_option_id: selected,
          difficulty: Number(item.difficulty),
        },
      });
    } catch {
      setPhase("error");
      return;
    }

    usedInSession.current.add(item.id);
    askedPerNode.current.set(
      item.skill_node_id,
      (askedPerNode.current.get(item.skill_node_id) ?? 0) + 1,
    );
    results.current.push({ nodeId: item.skill_node_id, correct });
    targetDifficulty.current = nextTargetDifficulty(targetDifficulty.current, correct);

    setAnswered((n) => n + 1);
    setFeedback({
      correct,
      topic: nodeNames.current.get(item.skill_node_id) ?? "Skill",
      previous: result.previous_mastery,
      next: result.new_mastery,
    });
    setPhase("feedback");
    setFeedbackVisible(true);
    if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    fadeTimer.current = window.setTimeout(() => setFeedbackVisible(false), 2000);
  }

  async function continueAfterFeedback() {
    if (!user || !sessionId) return;
    setFeedback(null);
    setFeedbackVisible(false);
    if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    setSelected(null);

    const finished = answered >= CALIBRATION_LENGTH;
    const nextItem = finished ? null : advance();

    if (!finished && nextItem) {
      setPhase("asking");
      return;
    }

    if (!finished && !nextItem && results.current.length === 0) {
      setPhase("error");
      return;
    }

    await finishSession(user.id, sessionId);
  }

  if (phase === "loading" || initializing) {
    return (
      <Shell>
        <Card className="p-6 sm:p-8">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="mt-8 h-6 w-3/4" />
          <div className="mt-6 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      </Shell>
    );
  }

  if (phase === "error") {
    return (
      <Shell>
        <ErrorState
          message="We couldn't start your calibration."
          onRetry={() => window.location.reload()}
        />
      </Shell>
    );
  }

  if (phase === "done" && summary) {
    const pct = summary.total ? Math.round((summary.correct / summary.total) * 100) : 0;
    return (
      <Shell>
        <Card className="p-6 sm:p-8">
          <Badge tone="success">Calibration complete</Badge>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
            You answered {summary.correct} of {summary.total} correctly
          </h1>
          <ProgressBar value={pct} tone="success" className="mt-4" />

          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-success-soft/60 p-4">
              <h2 className="text-sm font-semibold text-foreground">Strengths</h2>
              {summary.strengths.length ? (
                <ul className="mt-2 space-y-1.5">
                  {summary.strengths.map((s) => (
                    <li key={s} className="text-sm text-muted-foreground">
                      ✓ {s}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nothing solid yet — that's exactly what the path is for.
                </p>
              )}
            </div>
            <div className="rounded-xl border border-border bg-warning-soft/60 p-4">
              <h2 className="text-sm font-semibold text-foreground">Focus areas</h2>
              {summary.improvements.length ? (
                <ul className="mt-2 space-y-1.5">
                  {summary.improvements.map((s) => (
                    <li key={s} className="text-sm text-muted-foreground">
                      → {s}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Strong across the board. Time to push into harder topics.
                </p>
              )}
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" onClick={() => navigate({ to: "/dashboard" })}>
              See my learning path
            </Button>
            <Link to="/dashboard">
              <Button variant="secondary" size="lg">
                Skip for now
              </Button>
            </Link>
          </div>
        </Card>
      </Shell>
    );
  }

  if (!current) {
    return (
      <Shell>
        <ErrorState message="No calibration questions are available for these subjects yet." />
      </Shell>
    );
  }

  const progress = (answered / CALIBRATION_LENGTH) * 100;
  const topic = nodeNames.current.get(current.skill_node_id);
  const level =
    Number(current.difficulty) < 0.35
      ? "Foundational"
      : Number(current.difficulty) < 0.65
        ? "Intermediate"
        : "Advanced";

  return (
    <Shell>
      <Card className="p-5 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {topic ? <Badge tone="primary">{topic}</Badge> : null}
            <Badge tone="neutral">{level}</Badge>
          </div>
          <p className="text-xs font-medium tabular-nums text-muted-foreground">
            Question {answered + 1} of {CALIBRATION_LENGTH}
          </p>
        </div>
        <ProgressBar value={progress} className="mt-4" />

        <h1 className="mt-8 text-xl font-semibold leading-snug text-foreground sm:text-2xl">
          {current.question_text}
        </h1>

        <div className="mt-6 space-y-3">
          {current.options.map((option) => {
            const active = selected === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={phase === "feedback" || phase === "saving"}
                onClick={() => setSelected(option.id)}
                className={`w-full min-h-11 rounded-xl border px-4 py-4 text-left text-base transition-all disabled:opacity-70 ${
                  active
                    ? "border-primary bg-primary-soft text-foreground ring-2 ring-primary/25"
                    : "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground"
                }`}
              >
                {option.text}
              </button>
            );
          })}
        </div>

        {/* Inline, non-blocking BKT feedback — real values from update_mastery. */}
        <div aria-live="polite" className="mt-6 min-h-[64px]">
          {feedback ? (
            <div
              className={`rounded-xl border px-4 py-3 transition-opacity duration-500 ${
                feedbackVisible ? "opacity-100" : "opacity-0"
              } ${
                feedback.correct
                  ? "border-success/40 bg-success-soft/40"
                  : "border-warning/40 bg-warning-soft/40"
              }`}
            >
              <p className="text-sm text-foreground">
                {feedback.correct
                  ? `Nice — that moved your grasp of ${feedback.topic} up.`
                  : `That one was tricky — we'll circle back to ${feedback.topic}.`}
              </p>
              <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <span className="tabular-nums">
                  Mastery updated: {feedback.previous.toFixed(2)} → {feedback.next.toFixed(2)}
                </span>
                <InfoTip label="mastery" text={HELP_TEXT.mastery} />
              </p>
            </div>
          ) : null}
        </div>

        <Button
          size="lg"
          className="mt-4 w-full sm:w-auto"
          onClick={phase === "feedback" ? continueAfterFeedback : submitAnswer}
          disabled={(phase !== "feedback" && selected === null) || phase === "saving" || finishing}
        >
          {phase === "saving"
            ? "Saving…"
            : finishing
              ? "Finishing…"
              : phase === "feedback"
                ? answered >= CALIBRATION_LENGTH
                  ? "See my results"
                  : "Next question"
                : "Check my answer"}
        </Button>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      title="Calibration"
      subtitle="Adaptive questions tuned to your goal, subjects and current level."
    >
      <div className="mx-auto w-full max-w-2xl">{children}</div>
    </AppShell>
  );
}
