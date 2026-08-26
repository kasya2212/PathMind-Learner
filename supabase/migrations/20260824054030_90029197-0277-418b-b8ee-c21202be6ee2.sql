ALTER TABLE public.learner_skill_state
  ADD COLUMN last_exposed_at timestamp with time zone;

COMMENT ON COLUMN public.learner_skill_state.last_exposed_at IS
  'Set when the learner opens the generated bridge module for this skill. Exposure only — never written by or read as a BKT observation; p_mastery and observation_count remain the sole mastery evidence.';