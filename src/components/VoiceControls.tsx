import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Primitives";

/**
 * Browser-native voice layer for the AI Tutor.
 *
 * - Input:  SpeechRecognition (webkit-prefixed where needed) — interim
 *   transcript is shown live; the final transcript is handed to the parent,
 *   which sends it through the SAME text pipeline as typed messages.
 * - Output: SpeechSynthesis lives in the parent (it owns the reply text);
 *   this component only renders the speaking/thinking states and Stop.
 *
 * Unsupported browsers simply never see this component — the parent keeps
 * text mode. Mic permission denial is surfaced via `onPermissionDenied`.
 */

type RecognitionResultLike = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEventLike = { results: ArrayLike<RecognitionResultLike> };
type RecognitionErrorLike = { error?: string };

type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: RecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type RecognitionCtor = new () => RecognitionLike;

export function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function VoiceControls({
  busy,
  speaking,
  onSend,
  onStopSpeaking,
  onPermissionDenied,
}: {
  /** True while the Tutor is generating a reply. */
  busy: boolean;
  /** True while the reply is being read aloud. */
  speaking: boolean;
  /** Final transcript → parent sends it through the text pipeline. */
  onSend: (text: string) => void;
  onStopSpeaking: () => void;
  /** Mic permission denied — parent switches to text mode with a notice. */
  onPermissionDenied: () => void;
}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recRef = useRef<RecognitionLike | null>(null);
  const finalRef = useRef("");
  const cancelledRef = useRef(false);

  // Cleanup on unmount — never leave the mic open.
  useEffect(
    () => () => {
      cancelledRef.current = true;
      recRef.current?.abort();
    },
    [],
  );

  function start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setVoiceError("Voice recognition isn't supported in this browser.");
      return;
    }
    setVoiceError(null);
    setInterim("");
    finalRef.current = "";
    cancelledRef.current = false;

    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interimText = "";
      let finalText = finalRef.current;
      for (let i = 0; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (!r) continue;
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      finalRef.current = finalText;
      setInterim((finalText + " " + interimText).trim());
    };

    rec.onerror = (e) => {
      setListening(false);
      recRef.current = null;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        onPermissionDenied();
      } else if (e.error === "no-speech") {
        setVoiceError("I didn't hear anything — tap to try again.");
      } else if (e.error !== "aborted") {
        setVoiceError("Voice recognition hiccuped — tap to try again.");
      }
    };

    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      const text = finalRef.current.trim();
      finalRef.current = "";
      setInterim("");
      if (!cancelledRef.current && text) onSend(text);
    };

    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
      recRef.current = null;
      setVoiceError("Couldn't start the microphone — please try again.");
    }
  }

  /** End recognition gracefully — the final transcript still sends. */
  function stopAndSend() {
    recRef.current?.stop();
  }

  function cancel() {
    cancelledRef.current = true;
    recRef.current?.abort();
    recRef.current = null;
    setListening(false);
    setInterim("");
  }

  if (speaking) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <span className="flex items-end gap-0.5" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="w-1 animate-pulse rounded-full bg-primary"
                style={{ height: 10 + (i % 3) * 5, animationDelay: `${i * 120}ms` }}
              />
            ))}
          </span>
          Speaking…
        </div>
        <Button type="button" variant="secondary" onClick={onStopSpeaking}>
          Stop
        </Button>
      </div>
    );
  }

  if (busy) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
        Thinking…
      </div>
    );
  }

  if (listening) {
    return (
      <div className="flex flex-col items-center gap-3 py-3">
        <button
          type="button"
          onClick={stopAndSend}
          aria-label="Stop and send"
          className="relative grid h-16 w-16 place-items-center rounded-full bg-primary text-xl text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105"
        >
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" aria-hidden="true" />
          ■
        </button>
        <p className="min-h-5 max-w-full truncate px-2 text-center text-sm text-muted-foreground">
          {interim || "Listening…"}
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="primary" onClick={stopAndSend}>
            Send
          </Button>
          <Button type="button" variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-3">
      <button
        type="button"
        onClick={start}
        aria-label="Tap to speak"
        className="grid h-16 w-16 place-items-center rounded-full border border-border bg-surface text-2xl shadow-sm transition-all hover:scale-105 hover:border-primary hover:shadow-primary/20"
      >
        🎙️
      </button>
      <p className="text-sm text-muted-foreground">Tap to speak</p>
      {voiceError ? (
        <p className="text-center text-xs text-amber-600 dark:text-amber-400">{voiceError}</p>
      ) : null}
    </div>
  );
}
