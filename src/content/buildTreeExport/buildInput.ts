/**
 * Turn the app's live drawer data (sides + unit dataset + resolved build pics)
 * into the pure {@link ExportInput} the generators consume. Reuses the exact
 * graph + layout the drawer uses — `buildBuildGraph` and `layoutBuildTree` — so
 * the exported scene matches the on-screen one. Pure and deterministic: node
 * order is BFS discovery order, edges follow the graph, no random ids.
 */

import type { Edge, Node } from "@xyflow/react";
import type { Side, UnitDatasetEntry, UnitDisplay } from "../bindings";
import { buildPicMissing } from "../buildPicMissing";
import { buildBuildGraph, buildEdgeMap } from "../buildTree";
import { layoutBuildTree } from "../pages/components/buildTreeLayout";
import {
  type ExportBranding,
  type ExportFaction,
  type ExportInput,
  type ExportNode,
  NODE_H,
  NODE_W,
  type UnitKind,
} from "./types";

/** One resolved unit display: friendly name and/or a base64 build-pic, and why
 * there is no build-pic when there isn't one. */
export interface PicEntry {
  name?: string;
  icon?: string;
  iconSkipped?: UnitDisplay["iconSkipped"];
}

/** Classify a unit for its ring colour, matching `BuildTreeDrawer`'s precedence:
 * commander > builder > mobile > building. */
function kindOf(
  id: string,
  startSet: Set<string>,
  edges: Map<string, string[]>,
  mobileSet: Set<string>,
): UnitKind {
  if (startSet.has(id)) return "commander";
  if ((edges.get(id)?.length ?? 0) > 0) return "builder";
  if (mobileSet.has(id)) return "mobile";
  return "building";
}

/** Build one faction's exported scene from its commander's reachable graph. */
export function buildFaction(
  side: Side,
  edges: Map<string, string[]>,
  fullByName: Map<string, string>,
  startSet: Set<string>,
  mobileSet: Set<string>,
  pics: Record<string, PicEntry>,
): ExportFaction {
  const graph = buildBuildGraph(side.startUnit, edges);
  const rfNodes: Node[] = graph.order.map((id) => ({
    id,
    position: { x: 0, y: 0 },
    data: {},
  }));
  const rfEdges: Edge[] = graph.treeEdges.map((e) => ({
    id: `t:${e.parent}->${e.child}`,
    source: e.parent,
    target: e.child,
  }));
  const laid = layoutBuildTree(rfNodes, rfEdges);
  const posById = new Map(laid.map((n) => [n.id, n.position]));

  const nodes: ExportNode[] = graph.order.map((id) => {
    const pos = posById.get(id) ?? { x: 0, y: 0 };
    const pic = pics[id];
    return {
      id,
      x: pos.x,
      y: pos.y,
      label: pic?.name ?? fullByName.get(id) ?? id,
      kind: kindOf(id, startSet, edges, mobileSet),
      icon: pic?.icon,
      noPic: pic?.icon ? undefined : buildPicMissing(pic),
    };
  });

  const factionEdges = [
    ...graph.treeEdges.map((e) => ({
      source: e.parent,
      target: e.child,
      extra: false,
    })),
    ...graph.extraEdges.map((e) => ({
      source: e.parent,
      target: e.child,
      extra: true,
    })),
  ];

  // Scene bounds: the node extent plus a small margin so edges/rings aren't
  // clipped at the viewBox edge.
  const margin = 40;
  const width = Math.max(NODE_W, ...nodes.map((n) => n.x + NODE_W)) + margin;
  const height = Math.max(NODE_H, ...nodes.map((n) => n.y + NODE_H)) + margin;

  return { side: side.name, nodes, edges: factionEdges, width, height };
}

/**
 * Assemble the full {@link ExportInput}. `sides` is the faction scope already
 * narrowed by the caller (all factions, or just the current one). `pics` merges
 * every resolved unit display across the exported factions; missing entries
 * render a "no pic" placeholder. `date` is the caller-supplied footer date.
 */
export function buildExportInput({
  gameName,
  sides,
  units,
  pics,
  branding,
  date,
}: {
  gameName: string;
  sides: Side[];
  units: UnitDatasetEntry[];
  pics: Record<string, PicEntry>;
  branding?: ExportBranding;
  date: string;
}): ExportInput {
  const edges = buildEdgeMap(units);
  const fullByName = new Map<string, string>();
  for (const u of units)
    if (u.fullName) fullByName.set(u.name.toLowerCase(), u.fullName);
  const mobileSet = new Set(
    units.filter((u) => u.mobile).map((u) => u.name.toLowerCase()),
  );
  const startSet = new Set(
    sides
      .map((s) => s.startUnit?.toLowerCase())
      .filter((u): u is string => !!u),
  );
  // Only factions with a reachable graph produce a canvas/tab.
  const factions = sides
    .map((s) => buildFaction(s, edges, fullByName, startSet, mobileSet, pics))
    .filter((f) => f.nodes.length > 0);
  return { gameName, factions, branding, date };
}
