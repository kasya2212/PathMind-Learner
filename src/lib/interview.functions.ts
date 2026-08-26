/**
 * AI Interview Portal — typed server functions (thin wrappers only).
 * All runtime logic lives in src/lib/interview.server.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  abandonInterviewSessionImpl,
  completeInterviewSessionImpl,
  getInterviewSessionImpl,
  listInterviewSessionsImpl,
  openInterviewSessionImpl,
  startInterviewSessionImpl,
  submitInterviewAnswerImpl,
} from "@/lib/interview.server";

/** Create-or-resume the learner's single active interview session. */
export const startInterviewSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { config?: unknown }) => ({ config: input?.config }))
  .handler(async ({ data, context }) =>
    startInterviewSessionImpl(context.supabase, context.userId, data.config),
  );

/** Resume-by-id for the live screen (mount/refresh). Never creates sessions. */
export const openInterviewSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { session_id: string }) => ({
    session_id: String(input?.session_id ?? ""),
  }))
  .handler(async ({ data, context }) =>
    openInterviewSessionImpl(context.supabase, context.userId, data.session_id),
  );

/** Pure read for the results screen: session + turns + evaluation if any. */
export const getInterviewSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { session_id: string }) => ({
    session_id: String(input?.session_id ?? ""),
  }))
  .handler(async ({ data, context }) =>
    getInterviewSessionImpl(context.supabase, context.userId, data.session_id),
  );

export const listInterviewSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => listInterviewSessionsImpl(context.supabase, context.userId));

/** Persist the learner's answer, then generate the interviewer's next message. */
export const submitInterviewAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { session_id: string; text: string }) => ({
    session_id: String(input?.session_id ?? ""),
    text: String(input?.text ?? ""),
  }))
  .handler(async ({ data, context }) =>
    submitInterviewAnswerImpl(context.supabase, context.userId, data.session_id, data.text),
  );

/** End the interview and generate the (single, idempotent) evaluation. */
export const completeInterviewSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { session_id: string }) => ({
    session_id: String(input?.session_id ?? ""),
  }))
  .handler(async ({ data, context }) =>
    completeInterviewSessionImpl(context.supabase, context.userId, data.session_id),
  );

/** End an in-progress interview without an evaluation. */
export const abandonInterviewSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { session_id: string }) => ({
    session_id: String(input?.session_id ?? ""),
  }))
  .handler(async ({ data, context }) =>
    abandonInterviewSessionImpl(context.supabase, context.userId, data.session_id),
  );
