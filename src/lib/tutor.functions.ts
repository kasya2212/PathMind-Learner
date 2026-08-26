/**
 * AI Tutor — typed server functions (thin wrappers).
 * All runtime logic lives in src/lib/tutor.server.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assembleTutorLearnerContext,
  createConversationImpl,
  deleteConversationImpl,
  getMessagesImpl,
  listConversationsImpl,
  sendMessageImpl,
} from "@/lib/tutor.server";

export const listTutorConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => listConversationsImpl(context.supabase, context.userId));

export const getTutorMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversation_id: string }) => ({
    conversation_id: String(input?.conversation_id ?? ""),
  }))
  .handler(async ({ data, context }) =>
    getMessagesImpl(context.supabase, context.userId, data.conversation_id),
  );

export const createTutorConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => createConversationImpl(context.supabase, context.userId));

export const deleteTutorConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversation_id: string }) => ({
    conversation_id: String(input?.conversation_id ?? ""),
  }))
  .handler(async ({ data, context }) =>
    deleteConversationImpl(context.supabase, context.userId, data.conversation_id),
  );

/**
 * Shared learner-context for the "Your Path" panel — DB reads only, no AI
 * call. Uses the SAME assembly function as the Tutor prompt.
 */
export const getTutorContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => assembleTutorLearnerContext(context.supabase, context.userId));

export const sendTutorMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversation_id: string; text: string }) => ({
    conversation_id: String(input?.conversation_id ?? ""),
    text: String(input?.text ?? ""),
  }))
  .handler(async ({ data, context }) =>
    sendMessageImpl(context.supabase, context.userId, data.conversation_id, data.text),
  );
