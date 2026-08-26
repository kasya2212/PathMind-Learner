import { useEffect, useRef } from "react";

/**
 * Cursor-driven light system — presentation only, never touches state.
 *
 * Renders one fixed radial glow that trails the pointer across the app
 * (mounted once in the app shell), and tracks the pointer over any
 * `.pm-spot` surface so its border light / inner glow (styles.css) follows
 * the cursor. Inert on touch devices and under prefers-reduced-motion.
 */
export function CursorLight() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let tx = window.innerWidth / 2;
    let ty = window.innerHeight * 0.35;
    let x = tx;
    let y = ty;
    let visible = false;

    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      if (!visible) {
        visible = true;
        el.style.opacity = "1";
      }
      // Per-card spotlight: update CSS vars on whichever .pm-spot is hovered.
      const spot = (e.target as HTMLElement | null)?.closest?.(".pm-spot");
      if (spot instanceof HTMLElement) {
        const rect = spot.getBoundingClientRect();
        spot.style.setProperty("--spot-x", `${e.clientX - rect.left}px`);
        spot.style.setProperty("--spot-y", `${e.clientY - rect.top}px`);
      }
    };
    const onLeave = () => {
      visible = false;
      el.style.opacity = "0";
    };
    const tick = () => {
      // Ease toward the pointer — a soft trail, never a hard snap.
      x += (tx - x) * 0.12;
      y += (ty - y) * 0.12;
      el.style.transform = `translate3d(${x - 340}px, ${y - 340}px, 0)`;
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[1] h-[680px] w-[680px] rounded-full opacity-0 transition-opacity duration-500"
      style={{
        background:
          "radial-gradient(circle, color-mix(in oklab, var(--primary) 7%, transparent) 0%, transparent 62%)",
      }}
    />
  );
}
