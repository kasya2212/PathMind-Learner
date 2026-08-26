export type PasswordCheck = {
  id: "length" | "letter" | "number" | "special";
  label: string;
  met: boolean;
  required: boolean;
};

export type PasswordStrength = {
  checks: PasswordCheck[];
  /** 0-4 */
  score: number;
  label: "Too short" | "Weak" | "Fair" | "Good" | "Strong";
  /** Backend (Supabase) minimum + our policy. */
  valid: boolean;
};

/**
 * Policy intentionally matches what the auth backend accepts:
 * 8+ characters, at least one letter and one number.
 * Special characters are encouraged, never required.
 */
export function evaluatePassword(password: string): PasswordStrength {
  const checks: PasswordCheck[] = [
    { id: "length", label: "At least 8 characters", met: password.length >= 8, required: true },
    { id: "letter", label: "Contains a letter", met: /[a-zA-Z]/.test(password), required: true },
    { id: "number", label: "Contains a number", met: /\d/.test(password), required: true },
    {
      id: "special",
      label: "Add a special character for stronger security",
      met: /[^a-zA-Z0-9]/.test(password),
      required: false,
    },
  ];

  const valid = checks.filter((c) => c.required).every((c) => c.met);

  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[a-zA-Z]/.test(password) && /\d/.test(password)) score += 1;
  if (password.length >= 12) score += 1;
  if (/[^a-zA-Z0-9]/.test(password) && /[A-Z]/.test(password)) score += 1;

  const label: PasswordStrength["label"] =
    password.length === 0
      ? "Too short"
      : !valid
        ? "Weak"
        : score <= 2
          ? "Fair"
          : score === 3
            ? "Good"
            : "Strong";

  return { checks, score: Math.min(score, 4), label, valid };
}

export function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login")) return "That email and password don't match an account.";
  if (lower.includes("already registered") || lower.includes("already been registered"))
    return "An account with this email already exists. Try signing in instead.";
  if (lower.includes("password")) return "That password doesn't meet the requirements below.";
  if (lower.includes("email")) return "Please enter a valid email address.";
  if (lower.includes("rate limit") || lower.includes("too many"))
    return "Too many attempts. Please wait a moment and try again.";
  return "Something went wrong. Please try again.";
}
