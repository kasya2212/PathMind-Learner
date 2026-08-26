import { useEffect, useMemo, useRef, useState } from "react";
import { layerNodes, masteryTone, type SkillEdge, type SkillNode } from "@/lib/pathmind";
import { HARD_PREREQ_WEIGHT } from "@/lib/replan";

const TONE_FILL: Record<string, string> = {
  none: "var(--mastery-none)",
  low: "var(--mastery-low)",
  mid: "var(--mastery-mid)",
  high: "var(--mastery-high)",
};

type Props = {
  nodes: SkillNode[];
  edges: SkillEdge[];
  /** Decayed mastery — what the learner can do *today*. */
  mastery: Map<string, number>;
  recommendedId?: string | null | undefined;
  hiddenGapIds?: Set<string>;
  selectedId?: string | null;
  onSelect?: (nodeId: string) => void;
  height?: number;
};

/**
 * Skill DNA graph: layered DAG with curved directional edges, mastery colour
 * coding, hidden-gap highlighting, zoom and pan.
 */
export function SkillGraph({
  nodes,
  edges,
  mastery,
  recommendedId,
  hiddenGapIds,
  selectedId,
  onSelect,
  height = 460,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const layout = useMemo(() => {
    const depth = layerNodes(nodes, edges);
    const columns = new Map<number, SkillNode[]>();
    for (const node of nodes) {
      const d = depth.get(node.id) ?? 0;
      const bucket = columns.get(d) ?? [];
      bucket.push(node);
      columns.set(d, bucket);
    }
    const colKeys = [...columns.keys()].sort((a, b) => a - b);
    const colGap = 210;
    const rowGap = 112;

    // Deep prerequisite chains would otherwise produce one absurdly wide row
    // that shrinks to nothing when fitted. Wrap the layers into bands so the
    // graph keeps a readable, roughly 16:9 shape at 100% zoom.
    const bandSize = Math.max(4, Math.min(6, Math.ceil(Math.sqrt(colKeys.length * 1.9))));
    const bands: number[][] = [];
    for (let i = 0; i < colKeys.length; i += bandSize) {
      bands.push(colKeys.slice(i, i + bandSize));
    }

    const positions = new Map<string, { x: number; y: number; r: number }>();
    let cursorY = 70;
    let maxX = 0;

    for (const band of bands) {
      const bandRows = Math.max(1, ...band.map((k) => columns.get(k)!.length));
      const bandHeight = bandRows * rowGap;
      band.forEach((key, colIndex) => {
        const column = [...columns.get(key)!].sort((a, b) => a.name.localeCompare(b.name));
        column.forEach((node, rowIndex) => {
          const span = column.length;
          const x = 110 + colIndex * colGap;
          maxX = Math.max(maxX, x);
          positions.set(node.id, {
            x,
            y: cursorY + bandHeight / 2 + (rowIndex - (span - 1) / 2) * rowGap,
            r: 17 + Math.min(Number(node.effort_hours), 24) * 0.5,
          });
        });
      });
      cursorY += bandHeight + 60;
    }

    return {
      positions,
      width: Math.max(560, maxX + 130),
      height: Math.max(320, cursorY + 10),
    };
  }, [nodes, edges]);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [layout.width, layout.height]);

  // Focus mode: while a node is hovered or selected, everything that isn't
  // that node or one of its direct neighbours dims back — presentation only.
  const activeId = hovered ?? selectedId ?? null;
  const neighbours = useMemo(() => {
    if (!activeId) return null;
    const set = new Set<string>([activeId]);
    for (const e of edges) {
      if (e.from_node_id === activeId) set.add(e.to_node_id);
      if (e.to_node_id === activeId) set.add(e.from_node_id);
    }
    return set;
  }, [activeId, edges]);

  const viewW = layout.width / zoom;
  const viewH = layout.height / zoom;
  const minX = (layout.width - viewW) / 2 + pan.x;
  const minY = (layout.height - viewH) / 2 + pan.y;

  return (
    <div className="relative w-full">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-card/90 p-1 shadow-[var(--shadow-card)] backdrop-blur">
        <ZoomButton label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}>
          −
        </ZoomButton>
        <span className="w-10 text-center text-[11px] tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <ZoomButton label="Zoom in" onClick={() => setZoom((z) => Math.min(2.6, z + 0.2))}>
          +
        </ZoomButton>
        <ZoomButton
          label="Reset view"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          ⟲
        </ZoomButton>
      </div>

      <svg
        viewBox={`${minX} ${minY} ${viewW} ${viewH}`}
        style={{
          aspectRatio: `${layout.width} / ${layout.height}`,
          maxHeight: height,
          touchAction: "none",
        }}
        className="w-full cursor-grab select-none active:cursor-grabbing"
        role="img"
        aria-label="Skill DNA graph"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const scale = viewW / e.currentTarget.clientWidth;
          setPan({
            x: drag.current.panX - (e.clientX - drag.current.x) * scale,
            y: drag.current.panY - (e.clientY - drag.current.y) * scale,
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
        }}
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          setZoom((z) => Math.max(0.6, Math.min(2.6, z - e.deltaY * 0.002)));
        }}
      >
        <defs>
          <marker
            id="pm-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>

        {/* Edge visibility is deliberately weight-free: EVERY seeded edge is
            rendered so the full dependency structure stays discoverable
            (soft edges like Docker→deployment would vanish otherwise).
            Weight only changes the stroke style below. The 0.8
            HARD_PREREQ_WEIGHT threshold applies to GATING only — unlock
            logic, closure and gap detection all live in src/lib/replan.ts. */}
        {edges.map((edge) => {
          const a = layout.positions.get(edge.from_node_id);
          const b = layout.positions.get(edge.to_node_id);
          if (!a || !b) return null;
          const soft = Number(edge.weight) < HARD_PREREQ_WEIGHT;
          const active =
            hovered === edge.from_node_id ||
            hovered === edge.to_node_id ||
            selectedId === edge.from_node_id ||
            selectedId === edge.to_node_id;
          const dimmed = activeId !== null && !active;
          const mx = (a.x + b.x) / 2;
          return (
            <path
              key={`${edge.from_node_id}-${edge.to_node_id}`}
              d={`M ${a.x + a.r} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x - b.r - 8} ${b.y}`}
              fill="none"
              stroke="currentColor"
              className={
                active
                  ? "text-primary"
                  : soft
                    ? "text-muted-foreground/30"
                    : "text-muted-foreground/55"
              }
              strokeWidth={active ? 2.2 : soft ? 1.1 : 1.5}
              strokeDasharray={soft ? "5 5" : undefined}
              markerEnd="url(#pm-arrow)"
              style={{
                opacity: dimmed ? 0.22 : 1,
                transition: "opacity 240ms ease-out",
              }}
            />
          );
        })}

        {nodes.map((node, nodeIndex) => {
          const pos = layout.positions.get(node.id);
          if (!pos) return null;
          const value = mastery.get(node.id);
          const isGap = hiddenGapIds?.has(node.id) ?? false;
          const tone = masteryTone(value);
          const isHovered = hovered === node.id;
          const isSelected = selectedId === node.id;
          const isRecommended = recommendedId === node.id;
          const dimmed = neighbours !== null && !neighbours.has(node.id);
          const label = node.name;
          const stateWord =
            value === undefined
              ? "not assessed yet"
              : value < 0.4
                ? "just starting"
                : value <= 0.7
                  ? "building confidence"
                  : "solid grasp";
          return (
            <g
              key={node.id}
              transform={`translate(${pos.x} ${pos.y})`}
              tabIndex={0}
              role="button"
              aria-label={`${label} — ${stateWord}${
                value === undefined ? "" : ` (${Math.round(value * 100)} percent)`
              }${isGap ? ", hidden prerequisite" : ""}`}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(node.id)}
              onBlur={() => setHovered(null)}
              onClick={() => onSelect?.(node.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect?.(node.id);
                }
              }}
              className="graph-node-enter graph-dim outline-none [&:focus-visible>.pm-focus]:opacity-100"
              style={{
                cursor: onSelect ? "pointer" : "default",
                opacity: dimmed ? 0.3 : 1,
                animationDelay: `${Math.min(nodeIndex * 40, 480)}ms`,
              }}
            >
              <title>
                {`${label} — ${stateWord}${
                  value === undefined ? "" : ` (${Math.round(value * 100)}%)`
                }${isGap ? " · hidden prerequisite" : ""}`}
              </title>
              {/* 44×44 minimum tap target regardless of visual radius. */}
              <circle r={Math.max(pos.r, 22)} fill="transparent" />
              <circle
                className="pm-focus opacity-0 transition-opacity"
                r={pos.r + 12}
                fill="none"
                stroke="var(--ring)"
                strokeWidth={2}
              />
              {isGap ? (
                <circle
                  r={pos.r + 10}
                  fill="none"
                  stroke="var(--warning)"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                />
              ) : null}
              {isRecommended || isSelected ? (
                <circle r={pos.r + 8} fill="none" stroke="var(--primary)" strokeWidth={1.6} opacity={0.85} />
              ) : null}
              {isHovered ? (
                <circle r={pos.r + 6} fill="var(--primary)" opacity={0.14} />
              ) : null}
              <circle
                r={isHovered ? pos.r * 1.08 : pos.r}
                fill={isGap ? "var(--warning)" : TONE_FILL[tone]}
                fillOpacity={isRecommended || isSelected ? 1 : 0.92}
                stroke={isSelected || isRecommended ? "var(--primary)" : "var(--card)"}
                strokeWidth={isSelected ? 3 : 1.5}
                style={{
                  transition: "r 120ms ease-out",
                  filter:
                    isHovered || isSelected
                      ? "drop-shadow(var(--graph-node-shadow))"
                      : undefined,
                }}
              />
              {value !== undefined ? (
                <text
                  textAnchor="middle"
                  y={4}
                  className="fill-background"
                  style={{ fontSize: 13, fontWeight: 700 }}
                >
                  {Math.round(value * 100)}
                </text>
              ) : (
                <text
                  textAnchor="middle"
                  y={4}
                  className="fill-background"
                  style={{ fontSize: 13, fontWeight: 700 }}
                >
                  ?
                </text>
              )}
              <text
                y={pos.r + 20}
                textAnchor="middle"
                className={
                  isHovered || isRecommended || isSelected
                    ? "fill-foreground"
                    : "fill-muted-foreground"
                }
                style={{ fontSize: 14, fontWeight: isRecommended || isSelected ? 600 : 500 }}
              >
                {label.length > 22 ? `${label.slice(0, 21)}…` : label}
              </text>
            </g>
          );
        })}

      </svg>
    </div>
  );
}

function ZoomButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-md text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {children}
    </button>
  );
}
