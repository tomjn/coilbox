import { cn } from "@picoframe/frame";
import {
  Background,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { type CSSProperties, useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FactionLogo } from "@/factions/FactionLogo";
import type { FactionLogoSrc } from "@/factions/fallback";
import type { Side, UnitDatasetEntry } from "../../bindings";
import { buildBuildGraph, buildEdgeMap } from "../../buildTree";
import { useUnitsyncUnitBuildpics } from "../../config";
import { layoutBuildTree } from "./buildTreeLayout";

/** Data carried on each build-tree node: the unit's label + icon, and flags that
 * drive its ring — `isStart` (commander, blue) takes precedence over `isBuilder`
 * (construction unit / factory, yellow). */
interface UnitNodeData extends Record<string, unknown> {
  label: string;
  icon?: string;
  isBuilder?: boolean;
  isStart?: boolean;
  /** Mobile (can move) vs a static building — only distinguishes non-builders. */
  isMobile?: boolean;
  /** True for the currently-hovered node; reveals its connection handles. */
  hovered?: boolean;
}

/** A build-tree node: build-pic (square, fills the node) above the unit name.
 * Commanders get a blue ring, other builders a yellow ring; hovering lifts it. */
function UnitNode({ data }: NodeProps<Node<UnitNodeData>>) {
  return (
    <div
      className={cn(
        "flex w-[92px] flex-col items-center gap-1 rounded-lg border bg-card p-1.5 text-center shadow-sm transition-transform duration-100 hover:scale-[1.08]",
        data.isStart
          ? "border-blue-400/80 ring-2 ring-blue-400/70 shadow-[0_0_12px_rgba(96,165,250,0.45)]"
          : data.isBuilder
            ? "border-yellow-400/70 ring-2 ring-yellow-400/60 shadow-[0_0_12px_rgba(250,204,21,0.35)]"
            : data.isMobile
              ? "border-rose-400/90 ring-1 ring-rose-400/50" // mobile unit
              : "border-slate-400/40", // static building (non-builder)
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className={cn(
          "!pointer-events-none transition-opacity",
          // Built-by port: shown on hover only when something builds this unit
          // (i.e. it isn't the commander root).
          data.hovered && !data.isStart
            ? "!size-2.5 !border-0 !bg-yellow-400 !opacity-100"
            : "!opacity-0",
        )}
      />
      {data.icon ? (
        <img
          src={data.icon}
          alt=""
          className="aspect-square w-full rounded object-contain"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded bg-muted text-[0.65rem] text-muted-foreground">
          no pic
        </div>
      )}
      <span className="line-clamp-2 text-[0.7rem] leading-tight">
        {data.label}
      </span>
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={cn(
          "!pointer-events-none transition-opacity",
          // Builds port: shown on hover only when this unit builds something.
          data.hovered && data.isBuilder
            ? "!size-2.5 !border-0 !bg-green-400 !opacity-100"
            : "!opacity-0",
        )}
      />
    </div>
  );
}

const nodeTypes = { unitNode: UnitNode };

/** Dark-theme React Flow's Controls buttons via its CSS vars (defaults are white). */
const CONTROLS_THEME = {
  "--xy-controls-button-background-color": "#18181b",
  "--xy-controls-button-background-color-hover": "#27272a",
  "--xy-controls-button-color": "#e4e4e7",
  "--xy-controls-button-color-hover": "#ffffff",
  "--xy-controls-button-border-color": "#3f3f46",
} as CSSProperties;

const EDGE_COLOR = "#71717a";
/** Hover highlight colours by direction, relative to the hovered node. */
const EDGE_BUILDS = "#4ade80"; // green: what the hovered unit builds (outgoing)
const EDGE_BUILT_BY = "#facc15"; // yellow: what builds the hovered unit (incoming)
/** How long hover highlight/dim changes take, so they ease rather than snap.
 * Edge paths are animated via a CSS rule (inline `transition` on a React Flow
 * edge doesn't take — see EDGE_TRANSITION_CSS); nodes animate via inline style. */
const HOVER_MS = 1500;
const EDGE_TRANSITION_CSS = `.react-flow__edge-path{transition:stroke ${HOVER_MS}ms ease,stroke-width ${HOVER_MS}ms ease,opacity ${HOVER_MS}ms ease}`;

/**
 * Drawer body for a game's per-faction unit build graph. A clean spanning tree
 * (solid edges) is the readable backbone; every other real builder→unit
 * relationship is drawn as a faint dashed edge so the full DAG stays truthful.
 * Hovering a unit highlights all its connections (and dims the rest); a tab strip
 * switches factions. All switching is internal state — the drawer captures this
 * component once, so reopening per tab would reset pan/zoom.
 */
export function BuildTreeDrawer({
  enginePath,
  dataDir,
  gameArchive,
  sides,
  units,
  initialSide,
  factionLogos,
}: {
  enginePath: string;
  dataDir: string;
  gameArchive: string;
  sides: Side[];
  units: UnitDatasetEntry[];
  initialSide: string;
  /** Resolved faction emblems, keyed by lowercased side name (may be omitted). */
  factionLogos?: Record<string, FactionLogoSrc>;
}) {
  const [activeName, setActiveName] = useState(initialSide);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const active = sides.find((s) => s.name === activeName) ?? sides[0];

  const edges = useMemo(() => buildEdgeMap(units), [units]);
  // Internal name (lowercased) -> friendly name, for node labels.
  const fullByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units)
      if (u.fullName) m.set(u.name.toLowerCase(), u.fullName);
    return m;
  }, [units]);
  // Units that can move, so non-builders can be split into mobile vs building.
  const mobileSet = useMemo(
    () =>
      new Set(units.filter((u) => u.mobile).map((u) => u.name.toLowerCase())),
    [units],
  );
  // Every faction's start unit, so commanders can be blue-ringed.
  const startSet = useMemo(
    () =>
      new Set(
        sides
          .map((s) => s.startUnit?.toLowerCase())
          .filter((u): u is string => !!u),
      ),
    [sides],
  );

  const graph = useMemo(
    () => buildBuildGraph(active?.startUnit, edges),
    [active, edges],
  );
  const reachableCount = graph.order.length;
  const reachableKey = useMemo(
    () => [...graph.order].sort().join(","),
    [graph],
  );
  const reachableList = useMemo(
    () => (reachableKey ? reachableKey.split(",") : []),
    [reachableKey],
  );

  const buildpics = useUnitsyncUnitBuildpics(
    enginePath,
    dataDir,
    gameArchive,
    reachableList,
  );

  // Topology + layout — driven by the spanning tree only (clean backbone) and
  // independent of the later-arriving icons, so icons filling in don't re-layout.
  const laidOut = useMemo(() => {
    const nodes: Node<UnitNodeData>[] = graph.order.map((name) => ({
      id: name,
      type: "unitNode",
      position: { x: 0, y: 0 },
      // Give the minimap dimensions to draw before the node is measured.
      initialWidth: 92,
      initialHeight: 120,
      data: {
        label: fullByName.get(name) ?? name,
        // A builder is any unit that can build others, even if the spanning tree
        // handed its shared children to another builder.
        isBuilder: (edges.get(name)?.length ?? 0) > 0,
        isStart: startSet.has(name),
        isMobile: mobileSet.has(name),
      },
    }));
    const treeEdges: Edge[] = graph.treeEdges.map((e) => ({
      id: `t:${e.parent}->${e.child}`,
      source: e.parent,
      target: e.child,
      type: "smoothstep",
      data: { extra: false },
    }));
    const extraEdges: Edge[] = graph.extraEdges.map((e) => ({
      id: `x:${e.parent}->${e.child}`,
      source: e.parent,
      target: e.child,
      type: "smoothstep",
      data: { extra: true },
    }));
    return {
      nodes: layoutBuildTree(nodes, treeEdges),
      edgeDefs: [...treeEdges, ...extraEdges],
    };
  }, [graph, edges, fullByName, startSet, mobileSet]);

  // Undirected adjacency (tree + extra) for hover highlighting.
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      const set = m.get(a) ?? new Set<string>();
      set.add(b);
      m.set(a, set);
    };
    for (const e of laidOut.edgeDefs) {
      link(e.source, e.target);
      link(e.target, e.source);
    }
    return m;
  }, [laidOut]);

  // Inject resolved icons/labels, and dim nodes not connected to the hovered one.
  const nodes = useMemo(
    () =>
      laidOut.nodes.map((n) => {
        const display = buildpics?.units[n.id];
        const prev = n.data as UnitNodeData;
        const dimmed =
          hoveredId != null &&
          n.id !== hoveredId &&
          !adjacency.get(hoveredId)?.has(n.id);
        return {
          ...n,
          data: {
            label: display?.name ?? prev.label,
            icon: display?.icon,
            isBuilder: prev.isBuilder,
            isStart: prev.isStart,
            isMobile: prev.isMobile,
            hovered: n.id === hoveredId,
          },
          style: {
            opacity: dimmed ? 0.18 : 1,
            transition: `opacity ${HOVER_MS}ms`,
          },
        };
      }),
    [laidOut, buildpics, hoveredId, adjacency],
  );

  // Style edges: solid backbone vs faint dashed extras. On hover, the hovered
  // unit's outgoing edges (what it builds) go green and its incoming edges (what
  // builds it) go orange; everything else fades. All changes ease via a CSS
  // transition on the edge path.
  const styledEdges = useMemo(
    () =>
      laidOut.edgeDefs.map((e) => {
        const extra = (e.data as { extra?: boolean } | undefined)?.extra;
        const builds = hoveredId != null && e.source === hoveredId; // outgoing
        const builtBy = hoveredId != null && e.target === hoveredId; // incoming
        const incident = builds || builtBy;
        let style: CSSProperties;
        if (hoveredId != null && !incident) {
          style = {
            stroke: EDGE_COLOR,
            strokeWidth: 1,
            opacity: 0.05,
            ...(extra ? { strokeDasharray: "4 4" } : {}),
          };
        } else if (incident) {
          style = {
            stroke: builds ? EDGE_BUILDS : EDGE_BUILT_BY,
            strokeWidth: 2.5,
            opacity: 1,
            // Keep secondary (extra) edges dashed even when highlighted, so the
            // tree-vs-extra distinction survives hover.
            ...(extra ? { strokeDasharray: "6 4" } : {}),
          };
        } else {
          // Resting edges stay quiet so the grid blocks read cleanly despite the
          // unavoidable overlap of a hub's many connections; hover makes the
          // relevant ones pop.
          style = extra
            ? {
                stroke: EDGE_COLOR,
                strokeWidth: 1,
                opacity: 0.12,
                strokeDasharray: "4 4",
              }
            : { stroke: EDGE_COLOR, strokeWidth: 1.5, opacity: 0.4 };
        }
        // NB: the fade comes from a CSS rule on `.react-flow__edge-path`
        // (EDGE_TRANSITION_CSS), not inline — and no per-hover zIndex change,
        // which would re-parent the edge into another SVG layer and kill it.
        // On hover, a directional arrow at the target end shows build direction.
        return {
          ...e,
          style,
          markerEnd: incident
            ? {
                type: MarkerType.ArrowClosed,
                width: 16,
                height: 16,
                color: builds ? EDGE_BUILDS : EDGE_BUILT_BY,
              }
            : undefined,
        };
      }),
    [laidOut, hoveredId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, non-user CSS to animate React Flow edge paths (inline edge transition doesn't take) */}
      <style dangerouslySetInnerHTML={{ __html: EDGE_TRANSITION_CSS }} />
      {sides.length > 1 && (
        <Tabs value={active?.name ?? activeName} onValueChange={setActiveName}>
          <TabsList className="h-auto flex-wrap gap-1.5">
            {sides.map((s) => {
              const logo = factionLogos?.[s.name.toLowerCase()];
              return (
                <TabsTrigger
                  key={s.name}
                  value={s.name}
                  className="flex-none gap-1.5"
                >
                  {logo && (
                    <FactionLogo logo={logo} sideName={s.name} size={14} />
                  )}
                  {s.name}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      )}

      {reachableCount === 0 ? (
        <p className="rounded-lg border border-border/50 bg-card p-4 text-sm text-muted-foreground">
          No build options found for this faction. This game may not expose unit
          <span className="font-mono"> buildoptions</span> (e.g. legacy TDF
          games), or its commander builds nothing.
        </p>
      ) : (
        <>
          <BuildTreeLegend />
          <div
            className="min-h-[60vh] w-full flex-1 overflow-hidden rounded-lg border border-border/50 bg-background"
            style={CONTROLS_THEME}
          >
            <ReactFlow
              nodes={nodes}
              edges={styledEdges}
              nodeTypes={nodeTypes}
              onNodeMouseEnter={(_, node) => setHoveredId(node.id)}
              onNodeMouseLeave={() => setHoveredId(null)}
              // Read-only view: no editing, connecting, or selecting.
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              edgesFocusable={false}
              nodesFocusable={false}
              fitView
              // Keep nodes legible: fitView won't zoom out past 0.35 (big graphs
              // stay readable and pan), but the canvas can zoom out further for an
              // overview and in to 1.5 to inspect a unit.
              fitViewOptions={{ padding: 0.15, minZoom: 0.35, maxZoom: 1 }}
              minZoom={0.08}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                bgColor="#0a0a0a"
                // The un-masked hole over the current viewport is the "where am
                // I" indicator, so the mask needs contrast to show it; the dots
                // stay legible because they're bright, fully-opaque colours
                // (commanders blue, builders yellow, other units near-white).
                // (React Flow's minimap draws node dots only — it can't render edges.)
                maskColor="rgba(0,0,0,0.55)"
                maskStrokeColor="#93c5fd"
                maskStrokeWidth={3}
                nodeColor={(n) => {
                  const d = n.data as UnitNodeData | undefined;
                  return d?.isStart
                    ? "#60a5fa" // commander (blue)
                    : d?.isBuilder
                      ? "#fde047" // builder (yellow)
                      : d?.isMobile
                        ? "#fb7185" // mobile unit (red)
                        : "#e5e7eb"; // static building (near-white)
                }}
                nodeStrokeColor="#ffffff"
                nodeStrokeWidth={10}
                nodeBorderRadius={2}
                className="!rounded !border !border-border/50"
              />
            </ReactFlow>
          </div>
        </>
      )}
    </div>
  );
}

/** Colour/line key for the build graph, shown above the canvas. */
function BuildTreeLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="inline-block size-3 rounded-sm border-2 border-blue-400/80" />
        Commander
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block size-3 rounded-sm border-2 border-yellow-400/70" />
        Builder
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block size-3 rounded-sm border-2 border-rose-400/60" />
        Unit
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block size-3 rounded-sm border-2 border-slate-400/50" />
        Building
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4 rounded bg-green-400" />
        Builds (hover)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4 rounded bg-yellow-400" />
        Built by (hover)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-0 w-4 border-t-2 border-dashed border-muted-foreground/70" />
        Also buildable by
      </span>
    </div>
  );
}
