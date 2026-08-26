import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { evaluatePassword, friendlyAuthError } from "@/lib/password";
import { Button, Field, inputClass } from "@/components/Primitives";
import { AppHeader } from "@/components/AppHeader";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — PathMind" },
      {
        name: "description",
        content:
          "Sign in to PathMind to keep your skill graph, calibration results and learning plan history in sync.",
      },
      { property: "og:title", content: "Sign in — PathMind" },
      {
        property: "og:description",
        content: "Access your personalized Java backend learning path on PathMind.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

const STRENGTH_TONE = [
  "bg-destructive",
  "bg-destructive",
  "bg-warning",
  "bg-info",
  "bg-success",
];

function AuthPage() {
  const navigate = useNavigate();
  const { session, initializing } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const strength = useMemo(() => evaluatePassword(password), [password]);

  useEffect(() => {
    // Only redirect once the persisted session has actually been read.
    if (!initializing && session) navigate({ to: "/", replace: true });
  }, [initializing, session, navigate]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (mode === "signup" && !strength.valid) {
      setTouched(true);
      setError("Please meet the password requirements below.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (signUpError) setError(friendlyAuthError(signUpError.message));
        else if (!data.session)
          setMessage("Check your email to confirm your account, then sign in.");
        return;
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) setError(friendlyAuthError(signInError.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-md flex-col justify-center px-4 py-12 sm:px-6 sm:py-20">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {mode === "signin" ? "Welcome back." : "Create your account."}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your profile, mastery estimates and plan history stay tied to your account.
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
          <Field label="Email" htmlFor="email">
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="you@example.com"
            />
          </Field>

          <Field label="Password" htmlFor="password">
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setTouched(true);
                }}
                className={`${inputClass} pr-16`}
                placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </Field>

          {mode === "signup" && touched ? (
            <div className="rounded-xl border border-border bg-surface-raised p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-1 gap-1.5" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={`h-1.5 flex-1 rounded-full transition-colors ${
                        i < strength.score ? STRENGTH_TONE[strength.score] : "bg-surface-sunken"
                      }`}
                    />
                  ))}
                </div>
                <span className="text-xs font-medium text-muted-foreground">{strength.label}</span>
              </div>
              <ul className="mt-3 space-y-1.5">
                {strength.checks.map((check) => (
                  <li
                    key={check.id}
                    className={`flex items-center gap-2 text-xs ${
                      check.met
                        ? "text-success"
                        : check.required
                          ? "text-muted-foreground"
                          : "text-muted-foreground/80"
                    }`}
                  >
                    <span
                      className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full text-[9px] ${
                        check.met ? "bg-success text-success-foreground" : "bg-surface-sunken"
                      }`}
                    >
                      {check.met ? "✓" : ""}
                    </span>
                    {check.label}
                    {check.required ? "" : " (optional)"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">{message}</p>
          ) : null}

          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setMessage(null);
            setTouched(false);
          }}
          className="mt-6 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {mode === "signin" ? "No account yet? Create one" : "Already have an account? Sign in"}
        </button>

        <Link to="/" className="mt-2 text-sm text-muted-foreground hover:text-foreground">
          Back to home
        </Link>
      </main>
    </div>
  );
}
