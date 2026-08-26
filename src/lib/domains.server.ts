/**
 * Custom-domain generation — server-only helpers behind
 * `generateCustomDomain` (src/lib/domains.functions.ts).
 *
 * A learner's free-text goal becomes a real, reusable skill graph in the
 * existing tables: skill_nodes (scoped by a generated `domain` slug),
 * skill_edges and diagnostic_items. Generated domains are shared templates —
 * two learners with the same goal reuse the same graph; learner state stays
 * per-user in learner_skill_state exactly as before.
 *
 * Reads use the caller's authenticated client (SELECT policies allow it).
 * Inserts use the privileged admin client because the graph tables are
 * intentionally SELECT-only for authenticated users — writes only ever happen
 * here, after requireSupabaseAuth has verified the caller.
 */

export const GENERATED_DOMAIN_PREFIX = "gen_";

/** Stable, collision-resistant domain slug for a free-text goal. */
export function slugifyGoal(goalText: string): string {
  const normalized = goalText.trim().toLowerCase();
  const base = normalized
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  // djb2 — short deterministic hash so near-identical slugs don't collide.
  let hash = 5381;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) >>> 0;
  }
  return `${GENERATED_DOMAIN_PREFIX}${base || "custom"}_${hash.toString(36)}`;
}

export type GraphSpec = {
  domain_label: string;
  nodes: {
    name: string;
    description: string;
    effort_hours: number;
    is_required: boolean;
    market_weight: number;
  }[];
  edges: { from: number; to: number; weight: number }[];
  items: {
    node: number;
    question_text: string;
    options: string[];
    correct_index: number;
    difficulty: number;
  }[];
};

/** Bounds the rest of the platform relies on for a usable generated domain. */
const MIN_NODES = 8;
const MIN_EDGES = 6;
const MIN_ITEMS = 8;
const MAX_NODES = 18;
const MAX_EDGES = 60;
const MAX_ITEMS = 40;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function asIndex(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.floor(n) : -1;
}

/** Greedy cycle drop: keep edges in order, skip any that closes a loop. */
export function dropCyclicEdges(
  nodeCount: number,
  edges: GraphSpec["edges"],
): GraphSpec["edges"] {
  const adj = new Map<number, number[]>();
  const reaches = (from: number, to: number): boolean => {
    // Is there already a path `to` → … → `from`? Then from→to would cycle.
    const stack = [to];
    const seen = new Set<number>();
    while (stack.length) {
      const current = stack.pop()!;
      if (current === from) return true;
      for (const next of adj.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return false;
  };
  const kept: GraphSpec["edges"] = [];
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    if (edge.from >= nodeCount || edge.to >= nodeCount) continue;
    if (reaches(edge.from, edge.to)) continue;
    if (kept.some((e) => e.from === edge.from && e.to === edge.to)) continue;
    kept.push(edge);
    adj.set(edge.from, [...(adj.get(edge.from) ?? []), edge.to]);
  }
  return kept;
}

const SYSTEM_PROMPT = `You are a curriculum architect for an adaptive learning platform. You design skill graphs for ANY learning goal — careers, technologies, academic subjects, crafts, anything.

Respond with STRICT JSON only (no markdown fences, no commentary) matching exactly:
{
  "domain_label": string,
  "nodes": [{ "name": string, "description": string, "effort_hours": number, "is_required": boolean, "market_weight": number }],
  "edges": [{ "from": number, "to": number, "weight": number }],
  "items": [{ "node": number, "question_text": string, "options": [string, string, string, string], "correct_index": number, "difficulty": number }]
}

Rules:
- 12 to 16 nodes, ordered fundamentals → advanced. Node names are short skill/topic names, unique within the graph. The LAST node must be a capstone: a real project or outcome that proves the goal (name it like "Capstone: …").
- description: one sentence (max 30 words). effort_hours: realistic focused-study hours (4-40). is_required: false for at most 3 genuinely optional nodes. market_weight: 0-1, how much employers/the field value it.
- edges: prerequisite links as node INDEX pairs (from = prerequisite, to = dependent). weight 0.9-1.0 for hard prerequisites, 0.5-0.7 for helpful ones. The graph must be a DAG — no cycles — and every node except the capstone should lead somewhere.
- items: 2 diagnostic multiple-choice questions per node, spread across difficulties 0.15-0.9. The "options" array must contain EXACTLY 4 distinct strings and correct_index must be 0-3. Every node index used in edges and items must be a valid position in the nodes array. Questions test real understanding, never trivia about the platform.`;

/**
 * The model occasionally wraps the document one level deep
 * ({ "skill_map": { "nodes": … } }) or under a differently named key.
 * Unwrap the first nested object that carries a `nodes` array, keeping a
 * top-level domain_label when present.
 */
export function unwrapGraphRoot(parsed: unknown): Record<string, unknown> {
  const root = (parsed ?? {}) as Record<string, unknown>;
  if (Array.isArray(root["nodes"])) return root;
  for (const value of Object.values(root)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Array.isArray((value as Record<string, unknown>)["nodes"])
    ) {
      const inner = value as Record<string, unknown>;
      return { domain_label: root["domain_label"] ?? inner["domain_label"], ...inner };
    }
  }
  return root;
}

/**
 * Option entries are specified as plain strings, but the model sometimes
 * mirrors the database shape ({ "id": "a", "text": "…" }) or uses
 * label/value/option keys. Extract the text instead of dropping the item.
 */
function optionText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    for (const key of ["text", "label", "value", "option", "answer"]) {
      const v = o[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}

/**
 * Salvage-first normalization. The model occasionally returns a nearly
 * perfect document with a few malformed entries (an item with 3 options, a
 * stringified number, an out-of-range index). Rejecting the whole map for
 * that makes generation flaky, so each entry is repaired or dropped
 * individually — with edge/item indices remapped across node dedupe — and
 * the map is only rejected when what remains is genuinely too small.
 */
export function normalizeGraphSpec(parsed: unknown, fallbackLabel: string): GraphSpec {
  const root = unwrapGraphRoot(parsed);

  // --- Nodes: keep valid names, dedupe case-insensitively, salvage fields.
  const rawNodes = Array.isArray(root["nodes"]) ? root["nodes"] : [];
  const nodes: GraphSpec["nodes"] = [];
  let remap = new Map<number, number>(); // raw index -> node index
  const seenNames = new Map<string, number>();
  rawNodes.forEach((raw, i) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const name = typeof o["name"] === "string" ? o["name"].trim() : "";
    if (name.length < 2 || name.length > 90) return;
    const key = name.toLowerCase();
    const existing = seenNames.get(key);
    if (existing !== undefined) {
      remap.set(i, existing);
      return;
    }
    seenNames.set(key, nodes.length);
    remap.set(i, nodes.length);
    nodes.push({
      name,
      description: typeof o["description"] === "string" ? o["description"].slice(0, 500) : "",
      effort_hours: clampNumber(o["effort_hours"], 2, 80, 10),
      is_required: typeof o["is_required"] === "boolean" ? o["is_required"] : true,
      market_weight: clampNumber(o["market_weight"], 0, 1, 0.5),
    });
  });

  // Cap the node count, always keeping the last node (the capstone).
  if (nodes.length > MAX_NODES) {
    const keep = new Set<number>();
    for (let i = 0; i < MAX_NODES - 1; i += 1) keep.add(i);
    keep.add(nodes.length - 1);
    const nodeRemap = new Map<number, number>();
    const kept: GraphSpec["nodes"] = [];
    nodes.forEach((n, i) => {
      if (!keep.has(i)) return;
      nodeRemap.set(i, kept.length);
      kept.push(n);
    });
    nodes.length = 0;
    nodes.push(...kept);
    const next = new Map<number, number>();
    for (const [rawIdx, nodeIdx] of remap) {
      const mapped = nodeRemap.get(nodeIdx);
      if (mapped !== undefined) next.set(rawIdx, mapped);
    }
    remap = next;
  }

  // Edge/item endpoints are specified as node indices, but the model
  // sometimes uses node names instead — accept both.
  const nameToIndex = new Map(nodes.map((n, i) => [n.name.toLowerCase(), i]));
  const asNodeRef = (value: unknown): number | undefined => {
    const idx = asIndex(value);
    if (idx >= 0) return remap.get(idx);
    if (typeof value === "string") return nameToIndex.get(value.trim().toLowerCase());
    return undefined;
  };

  // --- Edges: remap indices, clamp weights, drop cycles/duplicates.
  const rawEdges = Array.isArray(root["edges"]) ? root["edges"] : [];
  const salvagedEdges: GraphSpec["edges"] = [];
  for (const raw of rawEdges) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const from = asNodeRef(o["from"]);
    const to = asNodeRef(o["to"]);
    if (from === undefined || to === undefined) continue;
    salvagedEdges.push({ from, to, weight: clampNumber(o["weight"], 0.3, 1, 0.8) });
  }
  const edges = dropCyclicEdges(nodes.length, salvagedEdges).slice(0, MAX_EDGES);

  // --- Items: require a valid node, a real question, exactly 4 options.
  const rawItems = Array.isArray(root["items"]) ? root["items"] : [];
  const items: GraphSpec["items"] = [];
  for (const raw of rawItems) {
    if (items.length >= MAX_ITEMS) break;
    const o = (raw ?? {}) as Record<string, unknown>;
    const node = asNodeRef(o["node"]);
    if (node === undefined) continue;
    const question = typeof o["question_text"] === "string" ? o["question_text"].trim() : "";
    if (question.length < 10) continue;
    const options = (Array.isArray(o["options"]) ? o["options"] : [])
      .map((x) => optionText(x))
      .filter((x) => x.length > 0 && x.length <= 240)
      .slice(0, 4);
    if (options.length !== 4) continue;
    items.push({
      node,
      question_text: question.slice(0, 500),
      options,
      correct_index: Math.round(clampNumber(o["correct_index"], 0, 3, 0)),
      difficulty: clampNumber(o["difficulty"], 0.1, 0.9, 0.5),
    });
  }

  if (nodes.length < MIN_NODES || edges.length < MIN_EDGES || items.length < MIN_ITEMS) {
    console.warn(
      `[domains] generated spec too small: ${nodes.length} nodes, ${edges.length} edges, ` +
        `${items.length} items (goal: "${fallbackLabel}")`,
    );
    throw new Error("The AI returned an incomplete skill map — please try again.");
  }

  const rawLabel = typeof root["domain_label"] === "string" ? root["domain_label"].trim() : "";
  return {
    domain_label: rawLabel.length >= 2 ? rawLabel.slice(0, 120) : fallbackLabel.slice(0, 120),
    nodes,
    edges,
    items,
  };
}

export async function generateDomainSpec(goalText: string, apiKey: string): Promise<GraphSpec> {
  let lastError: Error = new Error("Could not generate a skill map for that goal.");

  // One corrective retry: a validation failure is a model-output issue, not
  // an HTTP failure, so a second attempt with a stricter instruction is the
  // only retry that makes sense here.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const userContent =
      attempt === 0
        ? `Design the skill graph and diagnostic bank for this learner's goal: "${goalText}".`
        : `Your previous answer was rejected for malformed entries. Regenerate the COMPLETE skill graph for the goal "${goalText}": 12-16 unique nodes, every edge and item index within range, every item with exactly 4 string options. Strict JSON only.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.7-flash",
        temperature: 0.3,
        // Reasoning tokens count against this budget on gemini-3.7-flash —
        // 16k occasionally truncated the JSON mid-document on complex goals.
        max_tokens: 24000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      // HTTP-level failures are terminal except 429/5xx — surface and stop.
      if (response.status === 429) throw new Error("AI is busy right now — try again in a moment.");
      if (response.status === 402) throw new Error("AI credits are exhausted for this project.");
      if (response.status === 403) throw new Error("AI is not enabled for this project.");
      throw new Error("Could not generate a skill map for that goal.");
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    const choice = payload.choices?.[0];
    const raw = choice?.message?.content ?? "";

    // Token-budget truncation: the JSON is guaranteed to be cut off, so skip
    // parsing and go straight to the corrective attempt.
    if (choice?.finish_reason === "length") {
      console.warn(
        `[domains] generation truncated (goal: "${goalText}", ${raw.length} chars, attempt ${attempt + 1})`,
      );
      lastError = new Error("The AI returned an unreadable skill map — please try again.");
      continue;
    }

    const cleaned = raw
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.warn(
        `[domains] response not parseable (goal: "${goalText}", ${raw.length} chars, attempt ${attempt + 1})`,
      );
      lastError = new Error("The AI returned an unreadable skill map — please try again.");
      continue;
    }

    try {
      return normalizeGraphSpec(parsed, goalText);
    } catch (error) {
      lastError = error instanceof Error ? error : lastError;
    }
  }

  throw lastError;
}

export type DomainNodeRow = { id: string; name: string };

/**
 * Inserts a validated spec into the existing graph tables via the privileged
 * client. If a concurrent request already created the domain (unique name
 * clash), falls back to the rows that are already there — generation is
 * idempotent per domain slug.
 */
export async function insertDomainGraph(
  domain: string,
  spec: GraphSpec,
): Promise<DomainNodeRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Defensive dedupe: the LLM is instructed to produce unique names.
  const seen = new Set<string>();
  const nodes = spec.nodes.filter((n) => {
    const key = n.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const keptEdges = dropCyclicEdges(nodes.length, spec.edges);

  const { error: nodeError } = await supabaseAdmin.from("skill_nodes").insert(
    nodes.map((n) => ({
      domain,
      name: n.name.trim(),
      description: n.description || null,
      effort_hours: n.effort_hours,
      is_required: n.is_required,
      market_weight: n.market_weight,
    })),
  );

  // Read back to map names → real ids (insert order is not guaranteed).
  const { data: rows, error: readError } = await supabaseAdmin
    .from("skill_nodes")
    .select("id, name")
    .eq("domain", domain);
  if (readError) throw new Error(readError.message);
  const idByName = new Map((rows ?? []).map((r) => [r.name, r.id]));

  if (nodeError) {
    // Retry-safe persistence: a previous attempt for this domain slug may
    // have partially persisted (nodes committed, edges/items not), so the
    // insert above hit the UNIQUE(domain, name) constraint. If the rows
    // already present cover every node in this spec, continue with them —
    // the remaining inserts below complete the map. Anything else is a
    // genuine failure (including a concurrent complete map, which the
    // caller's catch-and-reuse path handles).
    const covered = nodes.every((n) => idByName.has(n.name.trim()));
    if (!covered) throw new Error(nodeError.message);
    console.warn(
      `[domains] node insert hit existing rows for "${domain}" — completing the existing partial map`,
    );
  }

  const nodeIds = nodes.map((n) => idByName.get(n.name.trim()));
  if (nodeIds.some((id) => !id)) throw new Error("Could not save the generated skill map.");

  const edgeRows = keptEdges
    .map((e) => ({
      from_node_id: nodeIds[e.from],
      to_node_id: nodeIds[e.to],
      weight: e.weight,
    }))
    .filter((e): e is { from_node_id: string; to_node_id: string; weight: number } =>
      Boolean(e.from_node_id && e.to_node_id),
    );
  if (edgeRows.length) {
    // ignoreDuplicates: completing a partially persisted map re-inserts
    // edges that may already exist (UNIQUE(from_node_id, to_node_id)).
    const { error } = await supabaseAdmin
      .from("skill_edges")
      .upsert(edgeRows, { onConflict: "from_node_id,to_node_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  const OPTION_IDS = ["a", "b", "c", "d"] as const;
  const itemRows = spec.items
    .map((item) => {
      const nodeId = nodeIds[item.node];
      if (!nodeId) return null;
      return {
        skill_node_id: nodeId,
        question_text: item.question_text,
        options: item.options.map((text, i) => ({ id: OPTION_IDS[i]!, text })) as never,
        correct_option_id: OPTION_IDS[item.correct_index]!,
        difficulty: item.difficulty,
      };
    })
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
  if (itemRows.length) {
    const { error } = await supabaseAdmin.from("diagnostic_items").insert(itemRows);
    if (error) throw new Error(error.message);
  }

  return nodes.map((n, i) => ({ id: nodeIds[i]!, name: n.name.trim() }));
}
