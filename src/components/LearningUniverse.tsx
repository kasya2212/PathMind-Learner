import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Landing hero centerpiece: a living 3D "learning universe".
 *
 * A glowing core (the recommended next step) sits at the center of three
 * tilted orbital rings carrying skill nodes. Rings spin at different speeds
 * and directions; chips counter-rotate so they always face the viewer while
 * travelling through real 3D space (shared perspective on .lu-root).
 *
 * Interaction: the whole scene eases toward the cursor (lerped rAF loop),
 * drifts and fades gently on scroll, and a canvas starfield twinkles behind.
 * Idle sway keeps it alive on touch devices. Everything is transform/opacity
 * only, and all motion is disabled under prefers-reduced-motion.
 * Decorative — aria-hidden, no data, no interaction surface.
 */

type OrbitNode = {
  label: string;
  tone: "high" | "mid" | "low" | "none" | "goal";
  angle: number; // degrees on the ring
  delay: number; // float-phase offset
};

type Orbit = {
  radius: number; // px, half of ring diameter
  tiltX: number;
  tiltZ: number;
  duration: number; // seconds per revolution
  reverse?: boolean;
  nodes: OrbitNode[];
};

const ORBITS: Orbit[] = [
  {
    radius: 118,
    tiltX: 64,
    tiltZ: -12,
    duration: 42,
    nodes: [
      { label: "OOP", tone: "high", angle: 25, delay: 0.4 },
      { label: "SQL", tone: "mid", angle: 205, delay: 1.7 },
    ],
  },
  {
    radius: 178,
    tiltX: 72,
    tiltZ: 12,
    duration: 56,
    reverse: true,
    nodes: [
      { label: "Java basics", tone: "high", angle: 90, delay: 0.9 },
      { label: "REST APIs", tone: "mid", angle: 225, delay: 2.2 },
      { label: "Docker", tone: "none", angle: 340, delay: 1.2 },
    ],
  },
  {
    radius: 242,
    tiltX: 58,
    tiltZ: -30,
    duration: 72,
    nodes: [
      { label: "Spring Boot", tone: "low", angle: 60, delay: 0.2 },
      { label: "Testing", tone: "none", angle: 175, delay: 2.8 },
      { label: "Capstone", tone: "goal", angle: 295, delay: 1.5 },
    ],
  },
];

export function LearningUniverse({ className }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Cursor parallax + idle sway + scroll drift. One rAF loop, lerped.
  useEffect(() => {
    const root = rootRef.current;
    const scene = sceneRef.current;
    if (!root || !scene) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const host: HTMLElement = root.closest("section") ?? root;
    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;
    let raf = 0;
    let running = true;

    const onPointer = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      targetY = px * 10; // rotateY
      targetX = -py * 8; // rotateX
    };
    const onLeave = () => {
      targetX = 0;
      targetY = 0;
    };
    host.addEventListener("pointermove", onPointer);
    host.addEventListener("pointerleave", onLeave);

    const tick = (t: number) => {
      if (!running) return;
      const swayX = Math.sin(t / 3400) * 1.6;
      const swayY = Math.cos(t / 4200) * 2.1;
      curX += (targetX - curX) * 0.055;
      curY += (targetY - curY) * 0.055;
      scene.style.transform = `rotateX(${(curX + swayX).toFixed(3)}deg) rotateY(${(curY + swayY).toFixed(3)}deg)`;

      // Gentle scroll drift + fade as the hero leaves the viewport.
      const rect = root.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height)));
      root.style.opacity = String(1 - progress * 0.5);
      scene.style.translate = `0 ${(progress * 46).toFixed(1)}px`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      host.removeEventListener("pointermove", onPointer);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  // Starfield: slow drifting, twinkling particles in theme colors.
  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Resolve theme tokens through the cascade so canvas works in both themes.
    const probe = document.createElement("span");
    root.appendChild(probe);
    probe.style.color = "var(--primary)";
    const primary = getComputedStyle(probe).color;
    probe.style.color = "var(--foreground)";
    const foreground = getComputedStyle(probe).color;
    probe.remove();

    let w = 0;
    let h = 0;
    let raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    type Star = {
      x: number;
      y: number;
      r: number;
      vx: number;
      vy: number;
      phase: number;
      speed: number;
      tint: boolean;
    };
    let stars: Star[] = [];

    const resize = () => {
      const rect = root.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round((w * h) / 8500);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.6 + Math.random() * 1.4,
        vx: (Math.random() - 0.5) * 0.06,
        vy: -0.02 - Math.random() * 0.06,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.8,
        tint: Math.random() < 0.35,
      }));
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s.phase + (t / 900) * s.speed));
        ctx.globalAlpha = 0.13 * tw + 0.04;
        ctx.fillStyle = s.tint ? primary : foreground;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        s.x += s.vx;
        s.y += s.vy;
        if (s.y < -4) {
          s.y = h + 4;
          s.x = Math.random() * w;
        }
        if (s.x < -4) s.x = w + 4;
        if (s.x > w + 4) s.x = -4;
      }
      ctx.globalAlpha = 1;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(root);

    if (reduce) {
      draw(0);
      return () => ro.disconnect();
    }
    const loop = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={rootRef} className={cn("lu-root", className)} aria-hidden="true">
      <canvas ref={canvasRef} className="lu-stars" />
      <div className="lu-halo" />
      <div className="lu-stage">
        <div className="lu-enter">
          <div ref={sceneRef} className="lu-scene">
            {/* Energy links: signals flowing toward the core (2D layer at z=0). */}
            <svg className="lu-links" viewBox="0 0 560 560" fill="none">
              {[
                "M 40 430 C 150 380, 210 330, 262 292",
                "M 520 130 C 420 190, 350 230, 300 262",
                "M 500 470 C 410 420, 340 350, 296 300",
              ].map((d, i) => (
                <g key={i}>
                  <path d={d} stroke="var(--border-strong)" strokeWidth={1} opacity={0.45} />
                  <path
                    d={d}
                    stroke="var(--primary)"
                    strokeWidth={1.6}
                    opacity={0.6}
                    className="hero-flow"
                  />
                </g>
              ))}
            </svg>

            {ORBITS.map((orbit, oi) => (
              <div
                key={oi}
                className="lu-plane"
                style={{
                  transform: `rotateX(${orbit.tiltX}deg) rotateZ(${orbit.tiltZ}deg)`,
                }}
              >
                <div
                  className={cn("lu-ring", oi === 1 && "lu-ring--dashed")}
                  style={{ width: orbit.radius * 2, height: orbit.radius * 2 }}
                />
                <div
                  className="lu-spinner"
                  style={{
                    animation: `${orbit.reverse ? "pm-orbit-rev" : "pm-orbit"} ${orbit.duration}s linear infinite`,
                  }}
                >
                  {orbit.nodes.map((node) => (
                    <div
                      key={node.label}
                      className="lu-anchor"
                      style={{
                        transform: `rotate(${node.angle}deg) translateX(${orbit.radius}px) rotate(${-node.angle}deg)`,
                      }}
                    >
                      <div
                        className="lu-counter"
                        style={{
                          animation: `${orbit.reverse ? "pm-orbit" : "pm-orbit-rev"} ${orbit.duration}s linear infinite`,
                        }}
                      >
                        <div
                          className="lu-untilt"
                          style={{
                            transform: `rotateZ(${-orbit.tiltZ}deg) rotateX(${-orbit.tiltX}deg)`,
                          }}
                        >
                          <span
                            className={cn("lu-chip", `lu-chip--${node.tone}`)}
                            style={{ animationDelay: `${node.delay}s` }}
                          >
                            <span className="lu-chip__dot" />
                            {node.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Floating proof points at different depths. */}
            <span className="lu-stat lu-stat--tr">
              <span className="lu-chip__dot lu-dot--high" />
              Mastery 0.78 ↑
            </span>
            <span className="lu-stat lu-stat--bl">
              <span className="lu-chip__dot lu-dot--low" />
              2 hidden gaps found
            </span>

            {/* Core: the recommended next step. */}
            <div className="lu-core">
              <div className="lu-core__orbwrap">
                <span className="lu-core__pulse" />
                <span className="lu-core__pulse lu-core__pulse--late" />
                <span className="lu-core__orb">
                  <span className="lu-core__orb-label">REST APIs</span>
                </span>
              </div>
              <span className="lu-core__tag">
                <span className="lu-core__tag-dot" />
                Recommended next
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
