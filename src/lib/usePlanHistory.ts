import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { listPlanHistory } from "@/lib/history.functions";
import type { PlanHistoryRow } from "@/lib/why";

export type PlanHistoryEntry = PlanHistoryRow & { node_names: string[] };

/** Shared read of plan_history — powers both the Why panel and the history tab. */
export function usePlanHistory() {
  const { user } = useAuth();
  const load = useServerFn(listPlanHistory);
  const query = useQuery({
    queryKey: ["plan-history", user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => load({}),
  });
  return {
    rows: (query.data ?? []) as PlanHistoryEntry[],
    loading: query.isPending && Boolean(user?.id),
    error: query.isError,
  };
}
