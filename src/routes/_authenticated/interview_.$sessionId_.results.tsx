import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, InlineLoading } from "@/components/Primitives";
import { completeInterviewSession, getInterviewSession } from "@/lib/interview.functions";
import type { InterviewEvaluationLabel } from "@/lib/interview.shared";

export const Route = createFileRoute("/_authenticated/interview_/$sessionId_/results")({
  head: () => ({
    meta: [
      { title: "Interview Evaluation — PathMind" },
      {
        name: "description",
        content: "Your AI interview evaluation — strengths, areas to prepare, and readiness observations.",
      },
      { property: "og:title", content: "Interview Evaluation — PathMind" },
      {
        property: "og:description",
        content: "Your AI interview evaluation — strengths, areas to prepare, and readiness observations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InterviewResultsPage,
});

const LABEL_TONE: Record<InterviewEvaluationLabel, "success" | "warning" | "danger"> = {
  Strong: "success",
  Developing: "warning",
  "Needs work": "danger",
};

function InterviewResultsPage() {
  const { sessionId } = Route.useParams();
  const queryClient = useQueryClient();
  const getFn = useServerFn(getInterviewSession);
  const completeFn = useServerFn(completeInterviewSession);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const resultsQuery = useQuery({
    queryKey: ["interview-results", sessionId],
    queryFn: () => getFn({ data: { session_id: sessionId } }),
  });

  const session = resultsQuery.data?.session ?? null;
  const evaluation = resultsQuery.data?.evaluation ?? null;

  async function generateEvaluation() {
    if (generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await completeFn({ data: { session_id: sessionId } });
      if (res.evaluation) {
        await queryClient.invalidateQueries({ queryKey: ["interview-results", sessionId] });
      } else {
        setGenerateError("There wasn't enough conversation to evaluate this interview.");
      }
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <AppShell
      title="Interview evaluation"
      subtitle={
        session
          ? `${session.config.targetRole} · ${session.config.durationMinutes} min · ${new Date(
              session.started_at,
            ).toLocaleDateString()}`
          : undefined
      }
    >
      {resultsQuery.isPending ? (
        <Card className="px-6 py-10">
          <InlineLoading label="Loading your evaluation…" />
        </Card>
      ) : resultsQuery.isError || !session ? (
        <ErrorState
          message="We couldn't load this interview."
          onRetry={() => resultsQuery.refetch()}
        />
      ) : evaluation ? (
        <div className="space-y-6">
          {/* Category cards */}
          <div className="grid gap-4 sm:grid-cols-2">
            {evaluation.categories.map((c) => (
              <Card key={c.name} interactive>
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-foreground">{c.name}</h2>
                    <Badge tone={LABEL_TONE[c.label] ?? "neutral"}>{c.label}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.notes}</p>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="What came across well" />
              <ul className="space-y-2.5 px-5 pb-5 pt-1 sm:px-6">
                {evaluation.strengths.length ? (
                  evaluation.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-foreground">
                      <span aria-hidden="true" className="mt-0.5 shrink-0 text-success">
                        ✓
                      </span>
                      {s}
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-muted-foreground">No highlights recorded.</li>
                )}
              </ul>
            </Card>

            <Card>
              <CardHeader title="Worth preparing more" />
              <ul className="space-y-2.5 px-5 pb-5 pt-1 sm:px-6">
                {evaluation.weaknesses.length ? (
                  evaluation.weaknesses.map((w, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-foreground">
                      <span aria-hidden="true" className="mt-0.5 shrink-0 text-warning-foreground">
                        →
                      </span>
                      {w}
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-muted-foreground">Nothing flagged — nice work.</li>
                )}
              </ul>
            </Card>
          </div>

          {evaluation.readiness_notes ? (
            <Card>
              <CardHeader title="Readiness notes" />
              <p className="px-5 pb-5 pt-1 text-sm leading-relaxed text-foreground sm:px-6">
                {evaluation.readiness_notes}
              </p>
            </Card>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Link to="/interview">
              <Button variant="primary">Start a new interview</Button>
            </Link>
            <Link to="/dashboard">
              <Button variant="secondary">Back to dashboard</Button>
            </Link>
          </div>
        </div>
      ) : session.status === "in_progress" ? (
        <EmptyState
          title="This interview is still in progress"
          description="Finish the conversation first — your evaluation is written at the end."
          action={
            <Link to="/interview/$sessionId" params={{ sessionId }}>
              <Button variant="primary">Continue interview</Button>
            </Link>
          }
        />
      ) : session.status === "completed" ? (
        <EmptyState
          title="Your evaluation isn't written yet"
          description="Generate it now — it only takes a moment, and it's based on everything you said."
          action={
            <div className="flex flex-col items-center gap-2">
              <Button variant="primary" onClick={generateEvaluation} disabled={generating}>
                {generating ? "Writing your evaluation…" : "Generate my evaluation"}
              </Button>
              {generateError ? (
                <p role="alert" className="text-sm text-destructive">
                  {generateError}
                </p>
              ) : null}
            </div>
          }
        />
      ) : (
        <EmptyState
          title="No evaluation for this interview"
          description="This interview ended before any answers were given, so there was nothing to evaluate."
          action={
            <Link to="/interview">
              <Button variant="primary">Start a new interview</Button>
            </Link>
          }
        />
      )}
    </AppShell>
  );
}
