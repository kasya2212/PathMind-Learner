import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CursorLight } from "@/components/PointerLight";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: "◧" },
  { to: "/tutor", label: "AI Tutor", icon: "✦" },
  { to: "/interview", label: "AI Interview", icon: "◉" },
  { to: "/skill-dna", label: "Skill DNA", icon: "◎" },
  { to: "/plan", label: "Learning plan", icon: "≡" },
  { to: "/gaps", label: "Skill gaps", icon: "⚠" },
  { to: "/diagnostic", label: "Calibration", icon: "◔" },
] as const;

/**
 * Full-viewport application shell: fixed sidebar on desktop, slide-over on
 * mobile. Page content fills the remaining width — no narrow centre column.
 */
export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          onClick={() => setOpen(false)}
          className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          activeProps={{ className: "bg-primary-soft text-primary font-medium" }}
        >
          <span aria-hidden="true" className="text-base leading-none">
            {item.icon}
          </span>
          {item.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-surface-sunken">
      <CursorLight />
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-4 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle navigation"
            className="grid h-11 w-11 place-items-center rounded-lg border border-border text-sm text-muted-foreground lg:hidden"
          >
            ☰
          </button>
          <Link to="/dashboard" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-[13px] font-bold text-primary-foreground">
              P
            </span>
            <span className="text-sm font-semibold tracking-tight text-foreground">PathMind</span>
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            <Link
              to="/"
              className="hidden min-h-11 items-center rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground sm:flex"
            >
              Profile
            </Link>
            <span className="hidden max-w-[16ch] truncate text-xs text-muted-foreground md:block">
              {user?.email}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="min-h-11 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-56 shrink-0 border-r border-border bg-background px-3 py-5 lg:block">
          {nav}
        </aside>

        {open ? (
          <div className="fixed inset-0 top-16 z-30 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-foreground/20"
              onClick={() => setOpen(false)}
            />
            <div className="relative h-full w-60 border-r border-border bg-background px-3 py-5">
              {nav}
            </div>
          </div>
        ) : null}

        <main className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8">
          <div className={cn("mx-auto w-full max-w-[1280px]")}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
                ) : null}
              </div>
              {actions}
            </div>
            <div className="mt-8">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
