/**
 * Plain-language layer over raw mastery numbers.
 *
 * The bands match the existing colour thresholds exactly (see `masteryTone`) —
 * this file only adds words, it never changes the maths.
 */

export type MasteryBand = "none" | "low" | "mid" | "high";

export function masteryBand(value: number | undefined | null): MasteryBand {
  if (value === undefined || value === null) return "none";
  if (value < 0.4) return "low";
  if (value <= 0.7) return "mid";
  return "high";
}

const LABELS: Record<MasteryBand, string> = {
  none: "Not assessed yet",
  low: "Just starting",
  mid: "Building confidence",
  high: "Solid grasp",
};

/** Small shape/glyph so mastery is never conveyed by colour alone. */
const GLYPHS: Record<MasteryBand, string> = {
  none: "○",
  low: "△",
  mid: "◐",
  high: "●",
};

export function masteryLabel(value: number | undefined | null): string {
  return LABELS[masteryBand(value)];
}

export function masteryGlyph(value: number | undefined | null): string {
  return GLYPHS[masteryBand(value)];
}

export function masteryPercent(value: number | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  return `${Math.round(value * 100)}%`;
}

/** "Building confidence · 58%" — label first, number as support. */
export function masterySentence(value: number | undefined | null): string {
  const pct = masteryPercent(value);
  return pct ? `${masteryLabel(value)} · ${pct}` : masteryLabel(value);
}

export const HELP_TEXT = {
  mastery:
    "How confidently our system thinks you know this skill right now, based on what you've shown us.",
  prerequisite: "You'll need to build up this skill before this one unlocks.",
  hiddenGap:
    "A skill your goal needs that we don't see in anything you've told us or tested you on yet.",
  decayed:
    "Skills fade a little the longer you go without practising them — like most things you learn.",
} as const;
