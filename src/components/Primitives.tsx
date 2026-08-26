import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { masteryBand, masteryGlyph, masteryLabel, masteryPercent } from "@/lib/mastery";

export function Card({
  children,
  className,
  as: Tag = "div",
  id,
  interactive = false,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "aside";
  id?: string;
  /** Cursor spotlight border + subtle lift on hover (pointer: fine only). */
  interactive?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Tag
      id={id}
      aria-label={ariaLabel}
      className={cn(
        "rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]",
        interactive && "pm-spot pm-card-hover",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "px-3 py-1.5 text-xs",
        size === "md" && "px-4 py-2.5 text-sm",
        size === "lg" && "px-6 py-3 text-sm sm:text-base",
        variant === "primary" &&
          "bg-primary text-primary-foreground shadow-[var(--shadow-card)] hover:-translate-y-px hover:shadow-[var(--shadow-raised)] hover:brightness-110 active:translate-y-0 active:scale-[0.98] active:brightness-95",
        variant === "secondary" &&
          "border border-border bg-card text-foreground hover:-translate-y-px hover:bg-secondary active:translate-y-0 active:scale-[0.98]",
        variant === "ghost" && "text-muted-foreground hover:bg-secondary hover:text-foreground",
        variant === "danger" && "bg-destructive text-destructive-foreground hover:brightness-110",
        className,
      )}
    />
  );
}

export function ProgressBar({
  value,
  className,
  tone = "primary",
  animateOnView = false,
}: {
  value: number;
  className?: string;
  tone?: "primary" | "success" | "warning";
  animateOnView?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const ref = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState(!animateOnView);

  useEffect(() => {
    if (!animateOnView) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setRevealed(true);
      return;
    }

    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [animateOnView]);

  return (
    <div
      ref={ref}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-sunken", className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-700 ease-out",
          tone === "primary" && "bg-primary",
          tone === "success" && "bg-success",
          tone === "warning" && "bg-warning",
        )}
        style={{ width: revealed ? `${clamped}%` : "0%" }}
      />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton-shimmer rounded-lg", className)} aria-hidden="true" />;
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning" | "danger" | "info";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
        tone === "neutral" && "bg-secondary text-secondary-foreground",
        tone === "primary" && "bg-primary-soft text-primary",
        tone === "success" && "bg-success-soft text-success",
        tone === "warning" && "bg-warning-soft text-warning-foreground",
        tone === "danger" && "bg-destructive-soft text-destructive",
        tone === "info" && "bg-info-soft text-info",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message = "We couldn't load this right now.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive-soft px-5 py-4">
      <p className="text-sm font-medium text-destructive">{message}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Your data is safe — this is just a display problem.
      </p>
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <div className="mt-2">{children}</div>
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

/**
 * One-sentence, tap/hover explanation of a system term. Deliberately not a
 * modal and not a glossary page.
 */
export function InfoTip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`What does "${label}" mean?`}
        title={text}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border text-[10px] leading-none text-muted-foreground transition-colors before:absolute before:-inset-3 before:content-[''] hover:border-primary hover:text-primary focus-visible:border-primary focus-visible:text-primary"
      >
        i
      </button>
      {open ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-[min(15rem,70vw)] -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-[var(--shadow-pop)]"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

/** Mastery shown the student-friendly way: words first, number as support. */
export function MasteryReadout({
  value,
  className,
  size = "md",
}: {
  value: number | undefined | null;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const band = masteryBand(value);
  const pct = masteryPercent(value);
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "self-center text-[13px] leading-none",
          band === "none" && "text-mastery-none",
          band === "low" && "text-mastery-low",
          band === "mid" && "text-mastery-mid",
          band === "high" && "text-mastery-high",
        )}
      >
        {masteryGlyph(value)}
      </span>
      <span
        className={cn(
          "font-medium text-foreground",
          size === "sm" && "text-sm",
          size === "md" && "text-base",
          size === "lg" && "text-xl",
        )}
      >
        {masteryLabel(value)}
      </span>
      {pct ? <span className="text-xs tabular-nums text-muted-foreground">{pct}</span> : null}
    </span>
  );
}

/** Colour + edge-style key for the skill graph. Uses only existing tokens. */
export function GraphLegend({ className }: { className?: string }) {
  const items = [
    { label: "Not assessed", swatch: "bg-mastery-none", glyph: "○" },
    { label: "Just starting", swatch: "bg-mastery-low", glyph: "△" },
    { label: "Building confidence", swatch: "bg-mastery-mid", glyph: "◐" },
    { label: "Solid grasp", swatch: "bg-mastery-high", glyph: "●" },
  ];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", item.swatch)}
          />
          <span className="leading-none">
            {item.glyph} {item.label}
          </span>
        </span>
      ))}
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <svg width="26" height="8" aria-hidden="true" className="shrink-0">
          <line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        <span className="leading-none">Required prerequisite</span>
      </span>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <svg width="26" height="8" aria-hidden="true" className="shrink-0 opacity-60">
          <line
            x1="0"
            y1="4"
            x2="26"
            y2="4"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeDasharray="4 4"
          />
        </svg>
        <span className="leading-none">Helpful but optional</span>
      </span>
    </div>
  );
}

/** Contextual loading line — never a bare spinner. */
export function InlineLoading({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2.5 text-sm text-muted-foreground" role="status">
      <span
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-primary"
      />
      {label}
    </p>
  );
}

/**
 * Scrollable region with a bottom fade that only appears while there is more
 * content below — signals scrollability without clipping rows harshly.
 */
export function FadeScroll({
  className,
  maxHeightClass = "max-h-96",
  children,
}: {
  className?: string;
  maxHeightClass?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [moreBelow, setMoreBelow] = useState(false);

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  };

  return (
    <div className={cn("relative", className)}>
      <div
        ref={(el) => {
          ref.current = el;
          // Measure after first paint and whenever content mutates.
          if (el) requestAnimationFrame(update);
        }}
        onScroll={update}
        className={cn("overflow-y-auto", maxHeightClass)}
      >
        {children}
      </div>
      {moreBelow ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-2xl bg-gradient-to-t from-card to-transparent"
        />
      ) : null}
    </div>
  );
}
