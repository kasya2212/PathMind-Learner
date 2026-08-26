-- PathMind AI Tutor: conversation persistence. Text and voice share this
-- single store — there is no parallel voice transcript system.

CREATE TABLE public.tutor_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutor_conversations TO authenticated;
GRANT ALL ON public.tutor_conversations TO service_role;

ALTER TABLE public.tutor_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tutor conversations"
  ON public.tutor_conversations
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.tutor_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.tutor_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutor_messages TO authenticated;
GRANT ALL ON public.tutor_messages TO service_role;

ALTER TABLE public.tutor_messages ENABLE ROW LEVEL SECURITY;

-- Message access is derived through conversation ownership: a learner can
-- only read or write messages in a conversation they own.
CREATE POLICY "Users manage own tutor messages"
  ON public.tutor_messages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tutor_conversations c
      WHERE c.id = tutor_messages.conversation_id
        AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tutor_conversations c
      WHERE c.id = tutor_messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

CREATE INDEX tutor_conversations_user_recent_idx
  ON public.tutor_conversations (user_id, last_message_at DESC NULLS LAST, created_at DESC);

CREATE INDEX tutor_messages_conversation_idx
  ON public.tutor_messages (conversation_id, created_at);