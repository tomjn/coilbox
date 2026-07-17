import type { WorldPos } from "../conquest/galaxy3d/layout";
import type { RunNode } from "./model";

/**
 * Pure forward-column layout for the run map — the piece `galaxy3d/layout.ts`
 * doesn't cover. That module *reprojects* authored 2D positions; a run instead
 * *derives* positions from graph structure: each node already carries a `col`
 * (forward rank) and `row` (cross-axis slot) from the generator, so here we
 * only map those to centred world coordinates. Kept free of three.js so it
 * unit-tests, and shared by both the galaxy and theatre skins (Y is always 0 —
 * a run map is a flat forward plane, not a scattered starfield).
 */

/** World-unit gap between adjacent columns (the forward/X axis). */
export const COLUMN_GAP = 26;

/** World-unit gap between adjacent rows within a column (the cross/Z axis). */
export const ROW_GAP = 20;

/**
 * Map each node's `(col, row)` to a centred world `[x, 0, z]`: columns spread
 * along X centred on 0, and each column's rows are centred on Z independently
 * (so a 2-node and a 4-node column both sit symmetric about the lane). An empty
 * input yields an empty map.
 */
export function columnLayout(nodes: RunNode[]): Map<string, WorldPos> {
  const out = new Map<string, WorldPos>();
  if (nodes.length === 0) return out;

  const cols = nodes.map((n) => n.col);
  const midCol = (Math.min(...cols) + Math.max(...cols)) / 2;

  // Per-column row midpoint, so each column centres on the lane regardless of
  // how many nodes it holds.
  const rowsByCol = new Map<number, number[]>();
  for (const n of nodes) {
    const list = rowsByCol.get(n.col);
    if (list) list.push(n.row);
    else rowsByCol.set(n.col, [n.row]);
  }
  const midRowByCol = new Map<number, number>();
  for (const [col, rows] of rowsByCol) {
    midRowByCol.set(col, (Math.min(...rows) + Math.max(...rows)) / 2);
  }

  for (const n of nodes) {
    const x = (n.col - midCol) * COLUMN_GAP;
    const z = (n.row - (midRowByCol.get(n.col) ?? 0)) * ROW_GAP;
    out.set(n.id, [x, 0, z]);
  }
  return out;
}
