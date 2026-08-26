CREATE TABLE public.interview_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','abandoned','expired')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_sessions TO authenticated;
GRANT ALL ON public.interview_sessions TO service_role;
ALTER TABLE public.interview_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own interview sessions" ON public.interview_sessions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX interview_sessions_user_active_idx ON public.interview_sessions (user_id, status, started_at DESC);

CREATE TABLE public.interview_turns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('interviewer','learner')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_turns TO authenticated;
GRANT ALL ON public.interview_turns TO service_role;
ALTER TABLE public.interview_turns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own interview turns" ON public.interview_turns FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.interview_sessions s WHERE s.id = interview_turns.session_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.interview_sessions s WHERE s.id = interview_turns.session_id AND s.user_id = auth.uid()));
CREATE INDEX interview_turns_session_idx ON public.interview_turns (session_id, created_at);

CREATE TABLE public.interview_evaluations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  categories jsonb NOT NULL DEFAULT '{}'::jsonb,
  strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  weaknesses jsonb NOT NULL DEFAULT '[]'::jsonb,
  readiness_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_evaluations TO authenticated;
GRANT ALL ON public.interview_evaluations TO service_role;
ALTER TABLE public.interview_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own interview evaluations" ON public.interview_evaluations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.interview_sessions s WHERE s.id = interview_evaluations.session_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.interview_sessions s WHERE s.id = interview_evaluations.session_id AND s.user_id = auth.uid()));