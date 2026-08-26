-- P0-5: explicit evidence source on learner_skill_state.
-- Default 'diagnostic' keeps every existing row interpretable as a real
-- diagnostic/task observation; nothing existing is reclassified as
-- self-reported. New application writes set the value explicitly.
ALTER TABLE public.learner_skill_state
  ADD COLUMN source text NOT NULL DEFAULT 'diagnostic';

ALTER TABLE public.learner_skill_state
  ADD CONSTRAINT learner_skill_state_source_check
  CHECK (source IN ('diagnostic', 'task', 'self_reported'));

-- P0-1/P0-2: canonical, validated, race-safe plan snapshot writes.
CREATE OR REPLACE FUNCTION public.record_plan_snapshot(p_trigger text, p_summary text, p_reasoning text, p_node_ids jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_old_ids jsonb;
  v_new_ids jsonb := '[]'::jsonb;
  v_el text;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Normalize the incoming snapshot: must be an array; keep only valid
  -- skill-node UUID strings, deduplicated, order preserved. The canonical
  -- stored shape is {"nodes": [<uuid>, ...]} — no display names, no
  -- parallel node_ids/items arrays.
  IF jsonb_typeof(p_node_ids) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_node_ids must be a jsonb array of skill node ids';
  END IF;
  FOR v_el IN SELECT value FROM jsonb_array_elements_text(p_node_ids) AS t(value) LOOP
    IF v_el ~ v_uuid AND NOT (v_new_ids ? v_el) THEN
      v_new_ids := v_new_ids || to_jsonb(v_el);
    END IF;
  END LOOP;

  -- Serialize concurrent replans per learner for the duration of this call.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text, 72042));

  -- Find the newest row that is a VALID canonical roadmap snapshot:
  -- a plan trigger AND a nodes field that is an array of pure UUIDs.
  -- Legacy rows (display names in `nodes`, parallel node_ids/items arrays)
  -- and non-plan payloads fail validation and are skipped — never read as
  -- the current plan, never modified.
  SELECT node_snapshot -> 'nodes' INTO v_old_ids
  FROM plan_history
  WHERE user_id = v_user
    AND trigger = ANY (ARRAY['plan_generated','initial_plan','time_budget_change','deadline_overdue'])
    AND jsonb_typeof(node_snapshot -> 'nodes') = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(node_snapshot -> 'nodes') AS el(value)
      WHERE el.value !~ v_uuid
    )
  ORDER BY created_at DESC
  LIMIT 1;

  -- Idempotency: identical ordered list → no new row.
  IF v_old_ids IS NOT NULL AND v_old_ids = v_new_ids THEN
    RETURN false;
  END IF;

  INSERT INTO plan_history (user_id, trigger, summary, reasoning, node_snapshot)
  VALUES (v_user, p_trigger, p_summary, p_reasoning, jsonb_build_object('nodes', v_new_ids));
  RETURN true;
END;
$function$