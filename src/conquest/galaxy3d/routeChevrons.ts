/**
 * Where the travelling direction chevrons of a Warpath run sit along a route.
 * The space map lays them on a straight lane. On a terrain map they follow the
 * road or sea crossing actually drawn, so these helpers sample a route that is
 * a set of polylines. Pure, so it tests without a scene.
 */

/** A point on the ground plane, in world units. */
export type GroundXZ = [number, number];

/** Where along a route the chevrons sit, as shares of its length. */
export const CHEVRON_FRACTIONS = [0.28, 0.5, 0.72] as const;

/** One chevron's place on a route, before its height is known. */
export interface ChevronSpot {
  x: number;
  z: number;
  /** Rotation about Y that aims a chevron's local +x along the route. */
  heading: number;
  /** Share of the route's length from its start, 0 to 1. */
  t: number;
}

/** A chevron ready to place: a position in the scene and a heading. */
export interface ChevronPlacement extends ChevronSpot {
  y: number;
}

/**
 * `pieces` turned round when it ends nearer `from` than it starts, so that the
 * route runs from `from` toward the far end. Each piece reverses with it.
 */
export function orientFrom(
  pieces: readonly (readonly GroundXZ[])[],
  from: GroundXZ,
): GroundXZ[][] {
  const kept = pieces.filter((p) => p.length > 0);
  if (kept.length === 0) return [];
  const first = kept[0][0];
  const lastPiece = kept[kept.length - 1];
  const last = lastPiece[lastPiece.length - 1];
  const distance = (p: GroundXZ) => Math.hypot(p[0] - from[0], p[1] - from[1]);
  if (distance(last) < distance(first)) {
    return kept.map((p) => [...p].reverse()).reverse();
  }
  return kept.map((p) => [...p]);
}

/**
 * The points at `fractions` of the way along `pieces`, with the direction the
 * route runs there. A fraction is a share of the length drawn, which leaves
 * out the gaps between pieces (a road cut where it passes through a town).
 * Returns nothing for a route with no length.
 */
export function spotsAlong(
  pieces: readonly (readonly GroundXZ[])[],
  fractions: readonly number[] = CHEVRON_FRACTIONS,
): ChevronSpot[] {
  interface Stretch {
    from: GroundXZ;
    dx: number;
    dz: number;
    length: number;
    /** Drawn length before this stretch. */
    before: number;
  }
  const stretches: Stretch[] = [];
  let total = 0;
  for (const piece of pieces) {
    for (let i = 1; i < piece.length; i++) {
      const dx = piece[i][0] - piece[i - 1][0];
      const dz = piece[i][1] - piece[i - 1][1];
      const length = Math.hypot(dx, dz);
      if (length === 0) continue;
      stretches.push({ from: piece[i - 1], dx, dz, length, before: total });
      total += length;
    }
  }
  if (total === 0) return [];
  return fractions.map((t) => {
    const target = t * total;
    const s =
      stretches.find((st) => target <= st.before + st.length) ??
      stretches[stretches.length - 1];
    const along = Math.min(1, Math.max(0, (target - s.before) / s.length));
    return {
      x: s.from[0] + s.dx * along,
      z: s.from[1] + s.dz * along,
      // Local +x turned by θ about Y points at (cosθ, 0, -sinθ).
      heading: Math.atan2(-s.dz, s.dx),
      t,
    };
  });
}
