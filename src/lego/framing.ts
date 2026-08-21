/**
 * Framing the selected piece with the camera, for the F shortcut.
 *
 * Pure for the same reason as snapping.ts: the distance maths is testable
 * without a renderer, and the viewport only has to hand over the piece's
 * world-space box and the direction it is already looking.
 */

import type { Vec3 } from "./snapping";

export interface Box3 {
  min: Vec3;
  max: Vec3;
}

export interface Framed {
  /** Where the orbit target moves to: the box centre. */
  target: Vec3;
  /** Where the camera moves to, along the direction it was already facing. */
  position: Vec3;
}

/** However small the piece, the camera stops this far out, so it never ends
 *  up inside the geometry. */
const MIN_FRAME_DISTANCE = 1.5;
/** Fitted tight against the box, the piece would sit flush with the edges of
 *  the view. This much slack keeps it comfortably inside them. */
const FRAME_PADDING = 1.3;

/**
 * Where to put the orbit target and the camera to frame `box`.
 *
 * The camera keeps looking along `offsetDirection`, the unit vector from the
 * orbit target to the camera, so pressing F pulls the view in rather than
 * spinning it round to a new angle.
 *
 * Distance comes from the box's bounding sphere rather than its faces:
 * fitting the sphere is orientation-independent, so the whole box is
 * guaranteed to fit whichever way it happens to be turned relative to the
 * camera, at the cost of some slack for a box that is not square-on. Only
 * the vertical field of view is used, matching `screenPixelsToWorld` in
 * snapping.ts, which makes the same simplification.
 *
 * There is no ceiling on the distance. There used to be one, at 60 world
 * units, to stop framing a whole unit sending the camera out to the horizon.
 * It clipped every unit read out of a game instead: Cortex's laboratory in
 * Beyond All Reason is 166 elmos across and wants a camera 432 out, so
 * framing it landed the camera inside the building. Any ceiling that cannot
 * clip has to be at least the fit distance, and a ceiling that is never below
 * the fit is one that never applies, so the honest version of it is none at
 * all. The distance is already proportionate to the box: framing fills the
 * view whatever is being framed, so there is no horizon to fly out to.
 * `MIN_FRAME_DISTANCE` is a floor, not a ceiling, and stays.
 */
export function frameBox(
  box: Box3,
  offsetDirection: Vec3,
  verticalFovRadians: number,
): Framed {
  const target: Vec3 = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  const size: Vec3 = [
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ];
  const radius = Math.hypot(...size) / 2;

  const fit = radius / Math.sin(verticalFovRadians / 2);
  const distance = Math.max(fit * FRAME_PADDING, MIN_FRAME_DISTANCE);

  const direction = normalise(offsetDirection);
  const position: Vec3 = [
    target[0] + direction[0] * distance,
    target[1] + direction[1] * distance,
    target[2] + direction[2] * distance,
  ];

  return { target, position };
}

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
