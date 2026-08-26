import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/Primitives";
import { cn } from "@/lib/utils";

/**
 * Optional camera self-view for the AI Interview. Video is LOCAL ONLY —
 * it is rendered back to the learner and never recorded, uploaded, or sent
 * to the AI. Permission denial or a missing camera degrades cleanly to
 * audio-only mode (the interview works exactly the same without it).
 */

export type CameraState = "starting" | "active" | "denied" | "unavailable" | "off";

export function CameraPreview({
  className,
  onStateChange,
}: {
  className?: string;
  onStateChange?: (state: CameraState) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>("starting");
  const [attempt, setAttempt] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [playError, setPlayError] = useState(false);
  const stateChangeRef = useRef(onStateChange);
  stateChangeRef.current = onStateChange;

  const report = useCallback((s: CameraState) => {
    setState(s);
    stateChangeRef.current?.(s);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function enable() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        report("unavailable");
        return;
      }
      try {
        // Camera only — the microphone stays with the separate voice pipeline.
        const media = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 } },
          audio: false,
        });
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        const videoTrack = media.getVideoTracks()[0];
        if (!videoTrack) {
          media.getTracks().forEach((t) => t.stop());
          report("unavailable");
          return;
        }
        videoTrack.addEventListener("ended", () => {
          if (!cancelled) report("unavailable");
        });
        streamRef.current = media;
        setStream(media);
        report("active");
      } catch (e) {
        if (cancelled) return;
        const name = (e as DOMException | null)?.name ?? "";
        report(
          name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable",
        );
      }
    }

    report("starting");
    setPlayError(false);
    void enable();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
    };
  }, [attempt, report]);

  // Attach the stream once BOTH the stream and the <video> element exist.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    let cancelled = false;
    el.play()
      .then(() => {
        if (!cancelled) setPlayError(false);
      })
      .catch(() => {
        if (!cancelled) setPlayError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [stream, state, enabled]);

  // Camera on/off toggles the track — the session and stream stay alive.
  useEffect(() => {
    streamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = enabled;
    });
  }, [enabled, stream]);

  function retry() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setEnabled(true);
    setAttempt((a) => a + 1);
  }

  const live = state === "active" && enabled;

  return (
    <div className={cn("overflow-hidden", className)}>
      <div className="relative aspect-video w-full overflow-hidden bg-surface-sunken">
        {/* The element is always mounted while a stream exists so srcObject can never miss it. */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label="Your camera self-view (private, never uploaded)"
          className={cn(
            "h-full w-full object-cover",
            live && !playError ? "block" : "hidden",
          )}
        />
        {live && !playError ? null : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            {state === "starting" ? (
              <p className="text-sm text-muted-foreground">Starting camera…</p>
            ) : state === "active" && !enabled ? (
              <>
                <p className="text-sm font-medium text-foreground">Camera off</p>
                <p className="max-w-[26ch] text-xs text-muted-foreground">
                  You're continuing in audio mode — your answers are what count.
                </p>
              </>
            ) : playError ? (
              <>
                <p className="text-sm font-medium text-foreground">Preview paused</p>
                <p className="max-w-[26ch] text-xs text-muted-foreground">
                  Your browser blocked autoplay. Tap below to show your self-view.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-1"
                  onClick={() => void videoRef.current?.play().then(() => setPlayError(false)).catch(() => setPlayError(true))}
                >
                  Show preview
                </Button>
              </>
            ) : state === "denied" ? (
              <>
                <p className="text-sm font-medium text-foreground">Camera is off</p>
                <p className="max-w-[26ch] text-xs text-muted-foreground">
                  No problem — the interview continues in audio mode. What you say is what matters.
                </p>
                <Button variant="secondary" size="sm" className="mt-1" onClick={retry}>
                  Enable camera
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">Camera unavailable</p>
                <p className="max-w-[26ch] text-xs text-muted-foreground">
                  It may be in use by another app or missing. The interview continues without video.
                </p>
                <Button variant="secondary" size="sm" className="mt-1" onClick={retry}>
                  Try again
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
          <span aria-hidden="true">🔒</span>
          Private self-view — video stays on this device and is never recorded or uploaded.
        </p>
        {state === "active" ? (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={enabled}
            onClick={() => setEnabled((v) => !v)}
          >
            {enabled ? "Turn camera off" : "Turn camera on"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
