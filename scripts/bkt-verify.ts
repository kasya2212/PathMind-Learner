/**
 * Development-only BKT verification (not shipped as a user-facing screen).
 *
 * Runs the exact engine used by the `update_mastery` server function
 * (`bktUpdate` from src/lib/bkt.ts, p_transit=0.15 / p_slip=0.10 / p_guess=0.20)
 * over the required sequence and prints the real resulting mastery values.
 *
 *   bun run scripts/bkt-verify.ts
 */
import { bktUpdate, DEFAULT_MASTERY } from "../src/lib/bkt";

let p = DEFAULT_MASTERY;
const lines = [`Initial: ${p.toFixed(2)}`];

const sequence: { label: string; correct: boolean }[] = [
  { label: "Correct #1", correct: true },
  { label: "Correct #2", correct: true },
  { label: "Correct #3", correct: true },
  { label: "Incorrect #1", correct: false },
];

for (const step of sequence) {
  p = bktUpdate(p, step.correct).new_mastery;
  lines.push(`${step.label}: ${p.toFixed(3)}`);
}

console.log(lines.join("\n"));
