import { type GalaxyNode, posZ } from "../model";

/**
 * Pure layout maths for the 3D galaxy view: authored 2D node positions map to
 * world XZ on the strategic plane, with a small deterministic Y jitter so the
 * play layer isn't perfectly flat. Kept free of three.js so it unit-tests.
 */

/** World-unit span of the play region's longest axis. */
export const PLAY_EXTENT = 100;

/** Node count whose play extent is exactly {@link PLAY_EXTENT} (the wizard's
 * Medium size), so pre-existing medium galaxies render unchanged. */
export const BASE_NODE_COUNT = 18;

/**
 * World-unit extent for a galaxy of `nodeCount` systems: area grows linearly
 * with the count, so average star density stays constant instead of packing
 * more stars into the same plane.
 */
export function playExtentFor(nodeCount: number): number {
  return PLAY_EXTENT * Math.sqrt(Math.max(1, nodeCount) / BASE_NODE_COUNT);
}

/** Max deterministic vertical jitter applied to each node (world units). */
export const Y_JITTER = 3;

/** Small stable string hash (FNV-1a), for per-node deterministic variation. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type WorldPos = [number, number, number];

/**
 * Map authored `pos: [x, y]` to centred world `[x, y, z]` coordinates: the
 * longest authored span scales to `extent` (default {@link PLAY_EXTENT};
 * aspect preserved, authored y becomes world z).
 *
 * World height comes from the authored third component when the galaxy has
 * one, scaled by the same factor as the other axes so real depth stays true to
 * real width. Galaxies without it keep the small hash-derived jitter, which
 * exists only so the play layer is not perfectly flat.
 *
 * A single node (or zero-span axis) lands at the origin rather than dividing
 * by zero.
 */
export function layoutNodes(
  nodes: Pick<GalaxyNode, "id" | "pos">[],
  extent: number = PLAY_EXTENT,
): Map<string, WorldPos> {
  const xs = nodes.map((n) => n.pos[0]);
  const ys = nodes.map((n) => n.pos[1]);
  const zs = nodes.map((n) => posZ(n.pos));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  // The span covers all three axes so a galaxy with real depth still fits the
  // extent. A flat galaxy has no z span, so its scale is unchanged.
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const scale = span > 0 ? extent / span : 0;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  // Real 3D positions replace the decorative jitter outright. Applying the
  // same scale to all three axes is what keeps the vertical spread honest.
  const hasDepth = nodes.some((n) => n.pos.length === 3);

  const out = new Map<string, WorldPos>();
  for (const n of nodes) {
    const jitter = ((hashString(n.id) % 1000) / 1000 - 0.5) * 2 * Y_JITTER;
    const y = hasDepth ? (posZ(n.pos) - cz) * scale : jitter;
    out.set(n.id, [(n.pos[0] - cx) * scale, y, (n.pos[1] - cy) * scale]);
  }
  return out;
}

export interface PlayBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** XZ bounding box of the laid-out nodes (camera-target clamp region). */
export function playBounds(positions: Iterable<WorldPos>): PlayBounds {
  const b: PlayBounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
  for (const [x, , z] of positions) {
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x);
    b.minZ = Math.min(b.minZ, z);
    b.maxZ = Math.max(b.maxZ, z);
  }
  if (b.minX > b.maxX) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  return b;
}
