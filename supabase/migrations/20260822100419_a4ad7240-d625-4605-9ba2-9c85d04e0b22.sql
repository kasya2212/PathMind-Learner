CREATE OR REPLACE FUNCTION public.record_plan_snapshot(
  p_trigger text,
  p_summary text,
  p_reasoning text,
  p_node_ids jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_latest jsonb;
  v_old_ids jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Serialize concurrent replans per learner for the duration of this call.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text, 72042));

  SELECT node_snapshot INTO v_latest
  FROM plan_history
  WHERE user_id = v_user
    AND trigger = ANY (ARRAY['plan_generated','initial_plan','time_budget_change','deadline_overdue'])
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_latest IS NOT NULL THEN
    -- Canonical shape stores IDs in `nodes`; legacy rows stored them in `node_ids`.
    v_old_ids := CASE
      WHEN jsonb_typeof(v_latest -> 'node_ids') = 'array' THEN v_latest -> 'node_ids'
      WHEN jsonb_typeof(v_latest -> 'nodes') = 'array' THEN v_latest -> 'nodes'
      ELSE '[]'::jsonb
    END;
    IF v_old_ids = p_node_ids THEN
      RETURN false;
    END IF;
  END IF;

  INSERT INTO plan_history (user_id, trigger, summary, reasoning, node_snapshot)
  VALUES (v_user, p_trigger, p_summary, p_reasoning, jsonb_build_object('nodes', p_node_ids));
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_plan_snapshot(text, text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_plan_snapshot(text, text, text, jsonb) TO authenticated;