/**
 * The scenario editor's scene, in the parts that are arithmetic rather than
 * three.js: where the camera starts, how far it may be pushed, and how engine
 * coordinates land in the scene.
 *
 * These are separate from the component so they can be tested without a GPU,
 * which the rest of the scene cannot be.
 */

/** Where a scenario position sits, or a point picked off the map. Engine world
 * units (elmos), measured from the map's north-west corner, with no height:
 * everything in a scenario sits on the ground. */
export interface WorldPos {
  x: number;
  z: number;
}

/** A point in the preview's scene space, which is centred on the map. */
export interface ScenePos {
  x: number;
  z: number;
}

/**
 * An engine position in scene space.
 *
 * The preview lays the terrain flat in XZ, centred on the origin, so engine
 * (0, 0) is the corner nearest negative X and negative Z. `scale` is the scene
 * units one elmo takes, which the preview reports because it normalises the
 * map's longer side to a fixed extent.
 */
export function worldToScene(
  pos: WorldPos,
  worldWidth: number,
  worldHeight: number,
  scale: number,
): ScenePos {
  return {
    x: (pos.x - worldWidth / 2) * scale,
    z: (pos.z - worldHeight / 2) * scale,
  };
}

/** The inverse of {@link worldToScene}, for turning a picked point back into a
 * scenario position. Not clamped to the map: a ray can land off the edge, and
 * the caller decides what that means. */
export function sceneToWorld(
  pos: ScenePos,
  worldWidth: number,
  worldHeight: number,
  scale: number,
): WorldPos {
  return {
    x: pos.x / scale + worldWidth / 2,
    z: pos.z / scale + worldHeight / 2,
  };
}

/** How high above the ground plane the camera starts, in radians. Steep enough
 * to read the map as a plan you are working on, shallow enough that relief
 * still shows. */
export const AUTHORING_PITCH = (58 * Math.PI) / 180;

/** Slack around the map at the starting distance, so the coastline is not
 * jammed against the edge of the viewport. */
const FRAMING_MARGIN = 1.12;

/**
 * The distance at which a `planeWidth` by `planeDepth` map fills a `fovDeg`
 * vertical-field camera at `aspect`, whichever of the two axes binds.
 *
 * Measured square on to the map. Tilting the camera foreshortens the depth
 * axis, so this is never too close, only ever a little generous.
 */
export function framingDistance(
  planeWidth: number,
  planeDepth: number,
  aspect: number,
  fovDeg: number,
): number {
  const vFov = (fovDeg * Math.PI) / 180;
  const byDepth = planeDepth / 2 / Math.tan(vFov / 2);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.01));
  const byWidth = planeWidth / 2 / Math.tan(hFov / 2);
  return Math.max(byDepth, byWidth) * FRAMING_MARGIN;
}

/**
 * Where the camera stands to open on the whole map, looking down at the centre
 * from the south. Capped at `maxDistance` so it stays inside the range the
 * preview's controls allow.
 */
export function authoringCamera(
  planeWidth: number,
  planeDepth: number,
  aspect: number,
  fovDeg: number,
  maxDistance: number,
): { x: number; y: number; z: number } {
  const d = Math.min(
    framingDistance(planeWidth, planeDepth, aspect, fovDeg),
    maxDistance,
  );
  return {
    x: 0,
    y: d * Math.sin(AUTHORING_PITCH),
    z: d * Math.cos(AUTHORING_PITCH),
  };
}

/**
 * How close the camera stands to something it has been asked to look at, in
 * elmos.
 *
 * Near enough that a single unit reads as a unit rather than a dot, which is the
 * whole point of being taken to one, and far enough that what is around it is
 * still on screen so the author knows where they have been put. Held to the
 * range the preview's controls allow by the caller, which is what stops a small
 * map being zoomed inside its own terrain.
 */
export const FOCUS_ELMOS = 1600;

/**
 * Where the camera stands to look closely at one point on the map, from the
 * south at the authoring pitch, so being taken to something looks like the view
 * the author already had rather than a new one.
 *
 * `y` is measured from the point being looked at, not from sea level, because
 * what is worth looking at stands on the ground and the ground is not flat.
 */
export function focusCamera(
  at: ScenePos,
  distance: number,
): { x: number; y: number; z: number } {
  return {
    x: at.x,
    y: distance * Math.sin(AUTHORING_PITCH),
    z: at.z + distance * Math.cos(AUTHORING_PITCH),
  };
}

/**
 * The point the camera may look at, held over the map.
 *
 * Panning is the main gesture here, and nothing off the map is worth looking
 * at, so the target cannot leave the terrain's footprint. Without this a pan
 * can carry the view into empty space with no way back but a reload.
 */
export function clampToPlane(
  pos: ScenePos,
  planeWidth: number,
  planeDepth: number,
): ScenePos {
  const halfW = planeWidth / 2;
  const halfD = planeDepth / 2;
  return {
    x: Math.min(halfW, Math.max(-halfW, pos.x)),
    z: Math.min(halfD, Math.max(-halfD, pos.z)),
  };
}

/** What the editing surface can show right now. */
export type MapSceneStatus =
  | "no-map"
  | "ready"
  | "loading"
  | "no-engine"
  | "error";

/**
 * Which of those it is.
 *
 * A scenario with no setup yet has no map to draw, which is the ordinary state
 * of a document a second after it is created rather than a fault. Beyond that
 * the map has to be read through unitsync, so it needs an engine to read it
 * with, and the read can fail because the map is not installed.
 */
export function mapSceneStatus(input: {
  mapName: string;
  hasEngine: boolean;
  enginesLoading: boolean;
  assetsLoading: boolean;
  ready: boolean;
}): MapSceneStatus {
  if (!input.mapName) return "no-map";
  if (input.ready) return "ready";
  if (input.enginesLoading || input.assetsLoading) return "loading";
  if (!input.hasEngine) return "no-engine";
  return "error";
}
