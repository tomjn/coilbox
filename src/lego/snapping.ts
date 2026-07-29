/**
 * Snapping one piece to another.
 *
 * Every part gets a set of anchors derived from its bounding box: the eight
 * corners, the six face centres and the middle. Nothing is authored, because
 * the parts library has no anchor data and the pieces are boxy enough that the
 * box is a good description of where they join.
 *
 * These anchors are an editor aid only. An anchor that has to survive into the
 * engine is an empty piece, which is a real s3o piece with a name.
 *
 * Pure on purpose: the maths is testable without a renderer, and the viewport
 * only has to convert to world space and apply the result.
 */

export type Vec3 = [number, number, number];

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export type AnchorKind = "corner" | "face" | "centre";

export interface Anchor {
  position: Vec3;
  kind: AnchorKind;
}

/**
 * Anchors in a part's own space.
 *
 * Corners first, because a corner is the more precise fit and ordering decides
 * ties when two anchors sit at the same distance.
 */
export function localAnchors(bounds: Bounds): Anchor[] {
  const { min, max } = bounds;
  const mid: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];

  const anchors: Anchor[] = [];
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        anchors.push({ position: [x, y, z], kind: "corner" });
      }
    }
  }

  anchors.push(
    { position: [min[0], mid[1], mid[2]], kind: "face" },
    { position: [max[0], mid[1], mid[2]], kind: "face" },
    { position: [mid[0], min[1], mid[2]], kind: "face" },
    { position: [mid[0], max[1], mid[2]], kind: "face" },
    { position: [mid[0], mid[1], min[2]], kind: "face" },
    { position: [mid[0], mid[1], max[2]], kind: "face" },
    { position: mid, kind: "centre" },
  );

  return anchors;
}

export interface Snap {
  /** Add this to the moving piece's position to seat it. */
  delta: Vec3;
  distance: number;
  /** Where the two anchors meet once the delta is applied. */
  at: Vec3;
  /** Which of the target anchors won, so the caller can say whose it is. */
  targetIndex: number;
}

/**
 * The closest pair of anchors within `threshold`, or null.
 *
 * Both sets are in world space. Distance is measured before the move, so the
 * nearest pair is the one the piece is already closest to seating against,
 * which is what makes dragging feel like it is looking for a fit rather than
 * jumping to the nearest surface.
 */
export function nearestSnap(
  moving: Vec3[],
  targets: Vec3[],
  threshold: number,
): Snap | null {
  let best: Snap | null = null;

  for (const from of moving) {
    for (const [index, to] of targets.entries()) {
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const dz = to[2] - from[2];
      const distance = Math.hypot(dx, dy, dz);
      if (distance > threshold) continue;
      if (best && distance >= best.distance) continue;
      best = { delta: [dx, dy, dz], distance, at: to, targetIndex: index };
    }
  }

  return best;
}

/** Round each angle to the nearest step, for rotation snapping. */
export function snapRotation(rotation: Vec3, stepRadians: number): Vec3 {
  if (stepRadians <= 0) return rotation;
  return rotation.map(
    (angle) => Math.round(angle / stepRadians) * stepRadians,
  ) as Vec3;
}
