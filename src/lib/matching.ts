const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "for",
  "in",
  "to",
  "with",
  "and",
  "intro",
  "introduction",
  "basics",
  "basic",
  "beginners",
  "beginner",
  "crash",
  "course",
  "fundamentals",
  "deep",
  "dive",
  "practice",
  "developers",
  "designing",
  "using",
]);

function normalize(token: string): string {
  // Light singularization so "APIs" matches "API", "collections" ~ "collection".
  if (token.length > 3 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
    .map(normalize);
}

/**
 * Conservative keyword match between a completed course label and a skill
 * node name. A single shared token is no longer enough — that made
 * "Spring Boot Fundamentals" claim "Spring Core (DI/IoC)".
 *
 * A course covers a node when either:
 *  1. they share at least 2 meaningful tokens, or
 *  2. the smaller token set is fully contained in the larger one
 *     (e.g. course "SQL for Beginners" [sql] ⊆ node "SQL Fundamentals" [sql]).
 */
export function courseMatchesNode(course: string, nodeName: string): boolean {
  const courseTokens = tokens(course);
  const nodeTokens = tokens(nodeName);
  if (courseTokens.length === 0 || nodeTokens.length === 0) return false;

  const courseSet = new Set(courseTokens);
  const nodeSet = new Set(nodeTokens);
  let shared = 0;
  for (const t of nodeSet) if (courseSet.has(t)) shared += 1;
  if (shared >= 2) return true;

  const smaller = courseSet.size <= nodeSet.size ? courseSet : nodeSet;
  const larger = courseSet.size <= nodeSet.size ? nodeSet : courseSet;
  for (const t of smaller) if (!larger.has(t)) return false;
  return true;
}
