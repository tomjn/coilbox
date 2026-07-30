/**
 * Snapping one piece to another.
 *
 * Every part gets a set of anchors derived from its bounding box: the eight
 * corners, the six face centres and the middle. The parts library has no anchor
 * data and most pieces are boxy enough that the box is a good description of
 * where they join.
 *
 * A piece can carry anchors of its own instead, for the parts where that is not
 * true: a curved intake or a rounded nose seats nowhere near its box. Those
 * replace the fifteen rather than joining them, because the box's guess is
 * wrong on exactly the parts this is for, and a wrong point left in the running
 * is a wrong point free to win the snap.
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

export type AnchorKind = "corner" | "face" | "centre" | "custom";

export interface Anchor {
  position: Vec3;
  kind: AnchorKind;
  /** A custom anchor's name, so a snap can say which seat it took. */
  name?: string;
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

/**
 * Everything a piece offers to snap against, in its part's own space.
 *
 * One answer, so nothing downstream has to decide between two sets. A piece
 * with anchors of its own uses those alone. A piece with a part uses its box.
 * A piece with neither still has its origin, which is what makes an empty
 * piece something you can seat a part against.
 */
export function pieceAnchors(
  bounds: Bounds | null,
  custom: readonly { name: string; position: Vec3 }[] | undefined,
): Anchor[] {
  if (custom && custom.length > 0) {
    return custom.map((anchor) => ({
      position: anchor.position,
      kind: "custom",
      name: anchor.name,
    }));
  }
  if (bounds) return localAnchors(bounds);
  return [{ position: [0, 0, 0], kind: "centre" }];
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

/** A piece this close to the camera cannot shrink the threshold to zero. */
const MIN_CAMERA_DISTANCE = 0.5;
/** The threshold never drops below this many world units, however tight the
 *  zoom. */
const MIN_SCREEN_THRESHOLD = 0.05;
/** The threshold never grows past this many world units, however far the
 *  zoom is pulled back, so a snap cannot reach across the whole scene. */
const MAX_SCREEN_THRESHOLD = 3;

/**
 * Convert a fixed number of screen pixels into a world-space distance, for a
 * perspective camera looking at something `distance` world units away.
 *
 * A snap should reach the same number of screen pixels whether the camera is
 * zoomed in tight or pulled right back. A perspective camera covers more
 * world space per pixel the further away it looks, so the pixel figure is
 * projected through the vertical field of view and the viewport height to
 * land back in world units at the piece's own distance.
 *
 * Distance and viewport height are clamped away from zero, and the result is
 * clamped to a sane range, so a piece sitting at the camera or an extreme
 * zoom cannot collapse the threshold to zero or blow it up to grab
 * everything on screen.
 */
export function screenPixelsToWorld(
  verticalFovRadians: number,
  viewportHeightPx: number,
  distance: number,
  pixels: number,
): number {
  const safeDistance = Math.max(distance, MIN_CAMERA_DISTANCE);
  const safeHeight = Math.max(viewportHeightPx, 1);
  const worldPerPixel =
    (2 * safeDistance * Math.tan(verticalFovRadians / 2)) / safeHeight;
  const threshold = pixels * worldPerPixel;
  return Math.min(
    Math.max(threshold, MIN_SCREEN_THRESHOLD),
    MAX_SCREEN_THRESHOLD,
  );
}
