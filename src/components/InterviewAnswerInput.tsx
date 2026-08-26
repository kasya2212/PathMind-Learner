import { useEffect, useMemo, useRef, useState } from "react";
import { getRecognitionCtor } from "@/components/VoiceControls";
import { Button } from "@/components/Primitives";
import { INTERVIEW_ANSWER_MAX } from "@/lib/interview.shared";
import { cn } from "@/lib/utils";

/**
 * Answer composer for the AI Interview: continuous browser-native
 * SpeechRecognition streams into an editable draft (review before sending),
 * with a fully equivalent typed fallback. Reuses the Tutor's exact
 * recognition plumbing (getRecognitionCtor) and permission-denial taxonomy.
 * The final text goes through the SAME submit path as a typed answer.
 */
export function InterviewAnswerInput({
  sending,
  disabled,
  onSend,
}: {
  sending: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);

  const recRef = useRef<InstanceType<NonNullable<ReturnType<typeof getRecognitionCtor>>> | null>(
    null,
  );
  const listeningRef = useRef(false);
  const baseRef = useRef("");
  const finalRef = useRef("");

  const recognitionSupported = useMemo(() => Boolean(getRecognitionCtor()), []);

  // Cleanup on unmount — never leave the mic open.
  useEffect(
    () => () => {
      listeningRef.current = false;
      recRef.current?.abort();
    },
    [],
  );

  function startListening() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setVoiceNotice("Voice input isn't supported in this browser — typing works exactly the same.");
      return;
    }
    setVoiceNotice(null);
    baseRef.current = draft.trim() ? `${draft.trim()} ` : "";
    finalRef.current = "";

    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true; // interview answers are longer than chat utterances
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interim = "";
      let final = finalRef.current;
      for (let i = 0; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (!r) continue;
        if (r.isFinal) final += `${r[0].transcript} `;
        else interim += r[0].transcript;
      }
      finalRef.current = final;
      setDraft((baseRef.current + final + interim).trimStart().slice(0, INTERVIEW_MAX_SAFE));
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        listeningRef.current = false;
        recRef.current = null;
        setListening(false);
        setMicDenied(true);
        setVoiceNotice(
          "Microphone access is off — typed answers work exactly the same. You can enable the mic in your browser settings.",
        );
      } else if (e.error === "no-speech") {
        setVoiceNotice("I didn't catch that — keep talking, or type instead.");
      } else if (e.error !== "aborted") {
        setVoiceNotice("Voice input hiccuped — your draft is safe. Tap the mic to continue.");
      }
    };

    rec.onend = () => {
      // Browsers stop continuous recognition on silence; restart while the
      // learner still has the mic toggled on.
      if (listeningRef.current) {
        try {
          rec.start();
          return;
        } catch {
          /* fall through to stopped state */
        }
      }
      listeningRef.current = false;
      recRef.current = null;
      setListening(false);
    };

    recRef.current = rec;
    listeningRef.current = true;
    setListening(true);
    try {
      rec.start();
    } catch {
      listeningRef.current = false;
      recRef.current = null;
      setListening(false);
      setVoiceNotice("Couldn't start the microphone — typing works exactly the same.");
    }
  }

  function stopListening() {
    listeningRef.current = false;
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }

  function handleSend() {
    const text = draft.trim();
    if (!text || sending || disabled) return;
    stopListening();
    setDraft("");
    onSend(text);
  }

  const nearLimit = draft.length > INTERVIEW_ANSWER_MAX * 0.75;

  return (
    <div className="px-4 py-4 sm:px-5">
      <label htmlFor="interview-answer" className="sr-only">
        Your answer
      </label>
      <textarea
        id="interview-answer"
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, INTERVIEW_MAX_SAFE))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        disabled={sending || disabled}
        placeholder={
          listening
            ? "Listening… speak your answer, review it here, then send."
            : "Type your answer, or tap the mic to speak it…"
        }
        rows={3}
        className="w-full resize-y rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {recognitionSupported && !micDenied ? (
          <button
            type="button"
            onClick={listening ? stopListening : startListening}
            disabled={sending || disabled}
            aria-pressed={listening}
            aria-label={listening ? "Stop voice input" : "Start voice input"}
            className={cn(
              "relative grid h-11 w-11 shrink-0 place-items-center rounded-full border text-lg transition-all disabled:opacity-50",
              listening
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface hover:border-primary",
            )}
          >
            {listening ? (
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" aria-hidden="true" />
            ) : null}
            <span aria-hidden="true">{listening ? "■" : "🎙"}</span>
          </button>
        ) : null}
        <p className="min-w-0 flex-1 text-xs text-muted-foreground" role="status">
          {listening
            ? "Listening…"
            : (voiceNotice ?? "Speak or type — you can edit before sending.")}
        </p>
        {nearLimit ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {draft.length.toLocaleString()} / {INTERVIEW_ANSWER_MAX.toLocaleString()}
          </span>
        ) : null}
        <Button
          type="button"
          onClick={handleSend}
          disabled={!draft.trim() || sending || disabled}
          size="md"
        >
          {sending ? "Sending…" : "Send answer"}
        </Button>
      </div>
    </div>
  );
}

/** Small headroom over the server cap so the UI trims before the server rejects. */
const INTERVIEW_MAX_SAFE = INTERVIEW_ANSWER_MAX;
