import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, RotateCcw, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  MasteryReadout,
  ProgressBar,
  Skeleton,
} from "@/components/Primitives";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { fetchDiagnosticItems, type DiagnosticItem } from "@/lib/pathmind";
import { updateMastery } from "@/lib/skilldna.functions";
import { masteryLabel } from "@/lib/mastery";
import { useSkillDna } from "@/lib/useSkillDna";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/practice/$nodeId")({
  head: () => ({
    meta: [
      { title: "Practice — PathMind" },
      {
        name: "description",
        content:
          "A focused practice round on one skill — every answer feeds your real mastery estimate and updates your plan.",
      },
      { property: "og:title", content: "Practice — PathMind" },
      {
        property: "og:description",
        content: "Focused practice that updates your live mastery.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PracticePage,
});

/**
 * Focused practice for ONE skill node. This is deliberately not a parallel
 * assessment system: it reuses the existing question bank for the node and
 * the authoritative `updateMastery` path (BKT, server-side). A practice run
 * opens its own `calibration_sessions` row with status 'practice' — never
 * 'in_progress', so calibration resume never picks it up, and it never
 * touches plan_history.
 */
function PracticePage() {
  const { nodeId } = useParams({ from: "/_authenticated/practice/$nodeId" });
  const { user } = useSession();
  const dna = useSkillDna();
  const queryClient = useQueryClient();
  const runUpdateMastery = useServerFn(updateMastery);

  const node = dna.allNodes.find((n) => n.id === nodeId) ?? null;

  // Easiest first — a gentle ramp rather than the diagnostic's adaptive probe.
  const itemsQuery = useQuery({
    queryKey: ["practice-items", nodeId],
    queryFn: async () => {
      const items = await fetchDiagnosticItems([nodeId]);
      return [...items].sort((a, b) => Number(a.difficulty) - Number(b.difficulty));
    },
  });
  const items: DiagnosticItem[] = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);
  const [masteryNow, setMasteryNow] = useState<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const closedRef = useRef(false);

  const current = items[index] ?? null;
  const done = items.length > 0 && index >= items.length;
  const baseline = masteryNow ?? dna.decayed.get(nodeId) ?? 0;

  // Close the practice session when the run finishes (fire-and-forget).
  useEffect(() => {
    if (!done || closedRef.current || !sessionIdRef.current) return;
    closedRef.current = true;
    void supabase
      .from("calibration_sessions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", sessionIdRef.current)
      .then(() => undefined);
  }, [done]);

  const submit = useMutation({
    mutationFn: async () => {
      if (!user?.id || !current || !selected) throw new Error("Pick an answer first.");
      if (!sessionIdRef.current) {
        const { data, error } = await supabase
          .from("calibration_sessions")
          .insert({ user_id: user.id, status: "practice" })
          .select("id")
          .single();
        if (error) throw error;
        sessionIdRef.current = data.id as string;
      }
      return await runUpdateMastery({
        data: {
          skill_node_id: nodeId,
          item_id: current.id,
          selected_option_id: selected,
          correct: selected === current.correct_option_id,
          difficulty: Number(current.difficulty),
          session_id: sessionIdRef.current,
        },
      });
    },
    onSuccess: async (res) => {
      setAnswered(true);
      setResults((r) => [...r, selected === current!.correct_option_id]);
      setMasteryNow(res.new_mastery);
      // Mastery moved → graph colours, next-step and review lists re-derive.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["learner-state", user?.id] }),
        queryClient.invalidateQueries({ queryKey: ["hidden-gaps", user?.id] }),
        queryClient.invalidateQueries({ queryKey: ["plan-snapshot", user?.id] }),
      ]);
    },
  });

  function nextQuestion() {
    setSelected(null);
    setAnswered(false);
    setIndex((i) => i + 1);
  }

  function restart() {
    setIndex(0);
    setSelected(null);
    setAnswered(false);
    setResults([]);
    sessionIdRef.current = null;
    closedRef.current = false;
  }

  const loading = dna.loading || itemsQuery.isPending;
  const correctCount = results.filter(Boolean).length;

  return (
    <AppShell
      title={node ? `Practice: ${node.name}` : "Practice"}
      subtitle={
        node?.description ??
        "A short, focused round — every answer feeds your real mastery estimate."
      }
      actions={
        <Link to="/dashboard">
          <Button variant="secondary" className="gap-1.5">
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
            Back to dashboard
          </Button>
        </Link>
      }
    >
      <div className="mx-auto grid w-full max-w-3xl gap-5">
        {loading ? (
          <Card className="p-6">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-4 h-6 w-3/4" />
            <Skeleton className="mt-5 h-11 w-full" />
            <Skeleton className="mt-2 h-11 w-full" />
          </Card>
        ) : !node ? (
          <EmptyState
            title="This skill isn't in your map"
            description="It may belong to a different skill graph. Head back to your dashboard and pick a step from your plan."
            action={
              <Link to="/dashboard">
                <Button size="sm">Go to dashboard</Button>
              </Link>
            }
          />
        ) : itemsQuery.isError ? (
          <EmptyState
            title="We couldn't load practice questions"
            description="Check your connection and try again."
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="No practice questions for this skill yet"
            description="Your calibration already covers this area — keep moving through your plan and check back after your next map update."
            action={
              <Link to="/plan">
                <Button size="sm">Back to your plan</Button>
              </Link>
            }
          />
        ) : done ? (
          <Card className="p-6 text-center sm:p-8">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">
              Practice complete
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {correctCount} of {results.length} correct
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Every answer updated your real mastery for {node.name} — your map and
              recommendations already reflect it.
            </p>
            <div className="mx-auto mt-5 max-w-xs">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">{node.name}</span>
                <MasteryReadout value={baseline} />
              </div>
              <ProgressBar className="mt-2" value={baseline * 100} />
              <p className="mt-1.5 text-xs text-muted-foreground">
                {masteryLabel(baseline)}
              </p>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <Button variant="secondary" className="gap-1.5" onClick={restart}>
                <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                Practice again
              </Button>
              <Link to="/skill-dna">
                <Button variant="ghost">See it on the map</Button>
              </Link>
              <Link to="/dashboard">
                <Button>Back to dashboard</Button>
              </Link>
            </div>
          </Card>
        ) : current ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <Badge tone="neutral">
                Question {index + 1} of {items.length}
              </Badge>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-xs text-muted-foreground">
                  {node.name} · {masteryLabel(baseline)}
                </span>
                <MasteryReadout value={baseline} size="sm" />
              </div>
            </div>
            <ProgressBar value={(index / items.length) * 100} />
            <Card className="p-5 sm:p-7">
              <h2 className="text-lg font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
                {current.question_text}
              </h2>
              <div className="mt-5 grid gap-2">
                {current.options.map((option) => {
                  const isSelected = selected === option.id;
                  const isCorrect = option.id === current.correct_option_id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={answered || submit.isPending}
                      onClick={() => setSelected(option.id)}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-all",
                        answered && isCorrect
                          ? "border-success bg-success-soft text-foreground"
                          : answered && isSelected && !isCorrect
                            ? "border-destructive bg-destructive-soft text-foreground"
                            : isSelected
                              ? "border-primary bg-primary-soft text-foreground"
                              : "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px]",
                          answered && isCorrect
                            ? "border-success bg-success text-success-foreground"
                            : answered && isSelected && !isCorrect
                              ? "border-destructive bg-destructive text-destructive-foreground"
                              : isSelected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border-strong",
                        )}
                      >
                        {answered && isCorrect ? (
                          <Check className="h-3 w-3" />
                        ) : answered && isSelected && !isCorrect ? (
                          <X className="h-3 w-3" />
                        ) : (
                          ""
                        )}
                      </span>
                      <span className="min-w-0 [overflow-wrap:anywhere]">{option.text}</span>
                    </button>
                  );
                })}
              </div>

              <div aria-live="polite" className="mt-5">
                {answered ? (
                  <div
                    className={cn(
                      "rounded-xl border px-4 py-3 text-sm",
                      selected === current.correct_option_id
                        ? "border-success/40 bg-success-soft/40 text-foreground"
                        : "border-warning/40 bg-warning-soft text-foreground",
                    )}
                  >
                    {selected === current.correct_option_id ? (
                      <>Correct — your mastery estimate for {node.name} just went up.</>
                    ) : (
                      <>
                        Not quite — the right answer is marked above. Your estimate adjusted so
                        your plan stays honest.
                      </>
                    )}
                  </div>
                ) : null}
                {submit.isError ? (
                  <p className="mt-3 text-sm text-destructive" role="alert">
                    We couldn't save that answer — try again.
                  </p>
                ) : null}
              </div>

              <div className="mt-6 flex items-center justify-end gap-2">
                {answered ? (
                  <Button className="gap-1.5" onClick={nextQuestion}>
                    {index + 1 === items.length ? "Finish practice" : "Next question"}
                    <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    onClick={() => submit.mutate()}
                    disabled={!selected || submit.isPending}
                  >
                    {submit.isPending ? "Saving…" : "Check answer"}
                  </Button>
                )}
              </div>
            </Card>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
