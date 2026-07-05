import type { Edge, Node } from "@xyflow/react";

/** Node box size + spacing for the build-graph layout, in px. */
export interface LayoutOptions {
  nodeW?: number;
  nodeH?: number;
  /** Horizontal gap between sibling nodes / blocks. */
  gapX?: number;
  /** Vertical gap between a node and its children row (a clear band for edges). */
  gapY?: number;
  /** Vertical gap between rows *within* a leaf grid (kept tight — no edges there). */
  gridGapY?: number;
}

/**
 * Position `nodes` as a compact 2-D tree. `edges` are the spanning-tree edges
 * (one parent per node). A node's *leaf* children (units that build nothing) are
 * packed into a square-ish grid block beneath it, while its *builder* children
 * lay out as sub-trees side by side. This trades the thin, ultra-wide single-row
 * strip a layered layout produces for a balanced block that uses vertical space.
 * Returns new node objects with `position`; inputs are not mutated.
 */
export function layoutBuildTree(
  nodes: Node[],
  edges: Edge[],
  {
    nodeW = 104,
    nodeH = 124,
    gapX = 16,
    gapY = 96,
    gridGapY = 16,
  }: LayoutOptions = {},
): Node[] {
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const e of edges) {
    const list = childrenOf.get(e.source);
    if (list) list.push(e.target);
    else childrenOf.set(e.source, [e.target]);
    hasParent.add(e.target);
  }
  const isLeaf = (id: string) => (childrenOf.get(id)?.length ?? 0) === 0;

  // Centre-x + top-y of each placed node.
  const pos = new Map<string, { cx: number; top: number }>();

  /**
   * Place `id` and its subtree with the subtree's left edge at `left` and the
   * node's top at `top`. Returns the subtree's total width.
   */
  function place(id: string, left: number, top: number): number {
    const children = childrenOf.get(id) ?? [];
    if (children.length === 0) {
      pos.set(id, { cx: left + nodeW / 2, top });
      return nodeW;
    }

    const leaves = children.filter(isLeaf);
    const builders = children.filter((c) => !isLeaf(c));
    const childTop = top + nodeH + gapY;
    let cursor = left;
    const blockCentres: number[] = [];

    // Leaf children pack into a square-ish grid block.
    if (leaves.length > 0) {
      // Square-ish grid: packs a builder's units into rows *and* columns rather
      // than one wide row, so a big set uses vertical space and stays narrow.
      const cols = Math.min(
        leaves.length,
        Math.max(1, Math.ceil(Math.sqrt(leaves.length))),
      );
      const gridW = cols * nodeW + (cols - 1) * gapX;
      leaves.forEach((leaf, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        pos.set(leaf, {
          cx: cursor + c * (nodeW + gapX) + nodeW / 2,
          top: childTop + r * (nodeH + gridGapY),
        });
      });
      blockCentres.push(cursor + gridW / 2);
      cursor += gridW + gapX * 2;
    }

    // Builder children lay out as sub-trees side by side.
    for (const b of builders) {
      const w = place(b, cursor, childTop);
      blockCentres.push(cursor + w / 2);
      cursor += w + gapX * 2;
    }

    const width = Math.max(nodeW, cursor - gapX * 2 - left);
    // Centre the node over the span of its child blocks.
    const cx = (Math.min(...blockCentres) + Math.max(...blockCentres)) / 2;
    pos.set(id, { cx, top });
    return width;
  }

  // Lay out each root (normally one — the commander) left to right.
  const roots = nodes.filter((n) => !hasParent.has(n.id));
  let left = 0;
  for (const r of roots) {
    left += place(r.id, left, 0) + gapX * 4;
  }

  return nodes.map((n) => {
    const p = pos.get(n.id) ?? { cx: nodeW / 2, top: 0 };
    // `place` stores centre-x/top; React Flow positions from the top-left corner.
    return { ...n, position: { x: p.cx - nodeW / 2, y: p.top } };
  });
}
