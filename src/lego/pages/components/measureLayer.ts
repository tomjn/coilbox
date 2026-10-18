/**
 * The measure tool in the scene: the lines it draws and their lengths, the
 * point a click lands on, and how far a dragged piece has moved.
 *
 * Everything here is a view aid. It is drawn in the scene, outside the unit's
 * root, so it is never part of the unit and never exported, and nothing is
 * saved with the document. Not in `overlay`: that follows the unit as it
 * drives, and an end on the ground has to stay where it was put.
 */

import * as THREE from "three";

import {
  endPosition,
  lineLabel,
  type MeasuredLine,
  type MeasureEnd,
  type Measurement,
} from "../../measure";
import { partUnit } from "../../pack";
import type { Vec3 } from "../../snapping";
import { dotMaterial, points } from "./dotsAndPoints";
import { pieceIdOf } from "./gizmoCommit";
import type { SceneState } from "./sceneState";
import { label } from "./weaponReachLayer";

export const MEASURE_COLOUR = 0x22d3ee;
/** A pale tint of the line colour, as the skeleton's labels are of theirs. */
const MEASURE_LABEL_COLOUR = "#a5f3fc";
const MEASURE_DOT = 9;

/** The lines as they are now drawn, and the one being made. */
export interface MeasureLines {
  lines: MeasuredLine[];
  pending: { from: Vec3; to: Vec3 | null } | null;
}

/** Which end of which measurement. */
export interface MeasureEndRef {
  id: string;
  end: "from" | "to";
}

/** What the scene keeps for the measure tool and the drag readout. The React
 *  side fills in the callbacks, since the scene is built once. */
export interface MeasureScene {
  /** Whether a click measures rather than selects. */
  active: boolean;
  /** Told the end a click chose, after snapping. */
  onPick?: (at: MeasureEnd) => void;
  /** Told where the pointer is while measuring, after snapping, or null when
   *  it leaves the model and the ground. */
  onHover?: (at: MeasureEnd | null) => void;
  /** Told where an end dragged by the pointer now is, after snapping. */
  onMoveEnd?: (which: MeasureEndRef, to: MeasureEnd) => void;
  /** Told where the lines are each time a frame moves one of them. */
  onLines?: (lines: MeasureLines) => void;
  /** Told how far the dragged piece is from where the drag began, or null once
   *  it is let go. */
  onDrag?: (moved: Vec3 | null) => void;
  /** Where the dragged piece was when the drag began. */
  dragFrom: Vec3 | null;
  /** The measurements drawn and the one being made. */
  measurements: Measurement[];
  pending: { from: MeasureEnd; to: MeasureEnd | null } | null;
  /** Where each end on a piece was last drawn, by `endKey`, so an end whose
   *  piece is deleted stays there. */
  last: Map<string, Vec3>;
  /** Where the lines were last drawn. */
  lines: MeasureLines;
  /** The lines now drawn, or null when there are none. */
  layer: THREE.Group | null;
}

export function newMeasureScene(): MeasureScene {
  return {
    active: false,
    dragFrom: null,
    measurements: [],
    pending: null,
    last: new Map(),
    lines: { lines: [], pending: null },
    layer: null,
  };
}

function endKey(id: string, end: "from" | "to"): string {
  return `${id}:${end}`;
}

/**
 * An end at the world point `at`. On the piece `pieceId` when it is given and
 * still in the scene, held as the point in that piece's own space, else a
 * world point.
 */
export function placeEnd(
  state: Pick<SceneState, "groups">,
  at: Vec3,
  pieceId: string | null,
): MeasureEnd {
  const group = pieceId ? state.groups.get(pieceId) : undefined;
  if (!pieceId || !group) return { at, on: null };
  group.updateWorldMatrix(true, false);
  const local = new THREE.Vector3(...at).applyMatrix4(
    group.matrixWorld.clone().invert(),
  );
  return { at, on: { pieceId, local: [local.x, local.y, local.z] } };
}

/**
 * Where an end is now. An end on a piece is read from the piece as it is drawn
 * this frame, posed by a script or not, and remembered under `key`, so it
 * keeps that place if the piece is deleted.
 */
export function locateEnd(
  state: Pick<SceneState, "groups"> & { measure: Pick<MeasureScene, "last"> },
  end: MeasureEnd,
  key: string,
): Vec3 {
  if (!end.on) return end.at;
  const group = state.groups.get(end.on.pieceId);
  if (!group) return endPosition(end, null, state.measure.last.get(key));
  group.updateWorldMatrix(true, false);
  const at = endPosition(end, group.matrixWorld.elements);
  state.measure.last.set(key, at);
  return at;
}

/** Where every line is now, the one being made last. */
export function locateLines(
  state: Pick<SceneState, "groups"> & {
    measure: Pick<MeasureScene, "last" | "measurements" | "pending">;
  },
): MeasureLines {
  const { measurements, pending } = state.measure;
  return {
    lines: measurements.map((m) => ({
      id: m.id,
      from: locateEnd(state, m.from, endKey(m.id, "from")),
      to: locateEnd(state, m.to, endKey(m.id, "to")),
    })),
    pending: pending
      ? {
          from: locateEnd(state, pending.from, "pending:from"),
          to: pending.to ? locateEnd(state, pending.to, "pending:to") : null,
        }
      : null,
  };
}

const same = (a: Vec3, b: Vec3) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

function sameLines(a: MeasureLines, b: MeasureLines): boolean {
  if (a.lines.length !== b.lines.length) return false;
  for (const [i, line] of a.lines.entries()) {
    const other = b.lines[i];
    if (
      line.id !== other.id ||
      !same(line.from, other.from) ||
      !same(line.to, other.to)
    )
      return false;
  }
  if (!a.pending || !b.pending) return a.pending === b.pending;
  if (!same(a.pending.from, b.pending.from)) return false;
  if (!a.pending.to || !b.pending.to) return a.pending.to === b.pending.to;
  return same(a.pending.to, b.pending.to);
}

/** Every end with the measurement and the side it belongs to, where it is
 *  now, for picking one up by its dot. */
export function endsOnScreen(
  lines: MeasuredLine[],
): (MeasureEndRef & { at: Vec3 })[] {
  return lines.flatMap((line) => [
    { id: line.id, end: "from" as const, at: line.from },
    { id: line.id, end: "to" as const, at: line.to },
  ]);
}

function disposeObject(object: THREE.Object3D) {
  if (
    object instanceof THREE.Line ||
    object instanceof THREE.Points ||
    object instanceof THREE.Sprite
  ) {
    // A sprite's geometry is shared by three.js between every sprite, and the
    // dots' round texture by every dot.
    if (!(object instanceof THREE.Sprite)) object.geometry.dispose();
    const material = object.material as THREE.Material & {
      map?: THREE.Texture | null;
    };
    if (object instanceof THREE.Sprite) material.map?.dispose();
    material.dispose();
  }
}

/** Free what the lines own and take them out of the scene. */
export function disposeMeasure(state: SceneState) {
  const layer = state.measure.layer;
  if (!layer) return;
  layer.traverse(disposeObject);
  layer.removeFromParent();
  state.measure.layer = null;
}

/**
 * Draw every measurement as a line with a dot at each end and its length at
 * its middle, and the one being made as a line to the pointer. Drawn over the
 * model, since a measurement across a part would otherwise vanish into it.
 *
 * Only the objects are made here. `layoutMeasurements` puts them where the
 * ends are on each frame drawn.
 */
export function drawMeasurements(
  state: SceneState,
  measurements: Measurement[],
  pending: { from: MeasureEnd; to: MeasureEnd | null } | null,
) {
  disposeMeasure(state);
  state.measure.measurements = measurements;
  state.measure.pending = pending;
  const keys = new Set(
    measurements.flatMap((m) => [endKey(m.id, "from"), endKey(m.id, "to")]),
  );
  for (const key of state.measure.last.keys()) {
    if (!keys.has(key)) state.measure.last.delete(key);
  }

  const lineCount = measurements.length + (pending?.to ? 1 : 0);
  const endCount =
    measurements.length * 2 + (pending ? (pending.to ? 2 : 1) : 0);
  if (endCount > 0) {
    const layer = new THREE.Group();
    layer.name = "measurements";
    if (lineCount > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(new Float32Array(lineCount * 6), 3),
      );
      const segments = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({
          color: MEASURE_COLOUR,
          depthTest: false,
          transparent: true,
        }),
      );
      segments.userData.role = "lines";
      segments.renderOrder = 3;
      segments.raycast = () => {};
      segments.frustumCulled = false;
      layer.add(segments);
    }
    const dots = points(
      new Array(endCount * 3).fill(0),
      null,
      dotMaterial(
        MEASURE_DOT,
        state.renderer.getPixelRatio(),
        false,
        MEASURE_COLOUR,
      ),
    );
    dots.userData.role = "dots";
    dots.frustumCulled = false;
    layer.add(dots);
    state.scene.add(layer);
    state.measure.layer = layer;
  }
  state.render();
}

/** The label for the `index`th line, made again only when its text has
 *  changed, since its text is drawn into its texture. */
function labelFor(
  layer: THREE.Group,
  index: number,
  text: string,
): THREE.Sprite {
  const old = layer.children.find(
    (child): child is THREE.Sprite =>
      child instanceof THREE.Sprite && child.userData.line === index,
  );
  if (old?.userData.text === text) return old;
  if (old) {
    disposeObject(old);
    layer.remove(old);
  }
  const sprite = label(text, MEASURE_LABEL_COLOUR);
  sprite.userData.line = index;
  sprite.userData.text = text;
  layer.add(sprite);
  return sprite;
}

/**
 * Put every line, dot and label where the ends are this frame, and tell the
 * readout when that has moved anything. Run before each render, since moving,
 * turning or animating a piece moves the ends on it.
 */
export function layoutMeasurements(state: SceneState) {
  const step = partUnit(state.packRef.current);
  const layer = state.measure.layer;
  const now = locateLines(state);
  if (layer) {
    const segments = layer.children.find((c) => c.userData.role === "lines") as
      | THREE.LineSegments
      | undefined;
    const dots = layer.children.find((c) => c.userData.role === "dots") as
      | THREE.Points
      | undefined;
    const lines = segments?.geometry.getAttribute("position");
    const ends = dots?.geometry.getAttribute("position");
    const all = now.pending?.to
      ? [...now.lines, { id: "pending", ...now.pending, to: now.pending.to }]
      : now.lines;
    all.forEach((line, i) => {
      lines?.setXYZ(i * 2, ...line.from);
      lines?.setXYZ(i * 2 + 1, ...line.to);
      ends?.setXYZ(i * 2, ...line.from);
      ends?.setXYZ(i * 2 + 1, ...line.to);
      labelFor(layer, i, lineLabel(line.from, line.to, step)).position.set(
        (line.from[0] + line.to[0]) / 2,
        (line.from[1] + line.to[1]) / 2,
        (line.from[2] + line.to[2]) / 2,
      );
    });
    // A first point with nothing yet to measure to.
    if (now.pending && !now.pending.to)
      ends?.setXYZ(all.length * 2, ...now.pending.from);
    if (lines) lines.needsUpdate = true;
    if (ends) ends.needsUpdate = true;
  }
  if (!sameLines(now, state.measure.lines)) {
    state.measure.lines = now;
    state.measure.onLines?.(now);
  }
}

/** Where a ray meets the ground: the shaped ground when one is drawn, else the
 *  flat plane at the unit's feet. */
export function groundPoint(
  state: Pick<SceneState, "groundShape" | "shaped">,
  raycaster: THREE.Raycaster,
): Vec3 | null {
  if (state.groundShape && state.shaped) {
    const hit = raycaster.intersectObject(state.shaped, false)[0];
    return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
  }
  const at = raycaster.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    new THREE.Vector3(),
  );
  return at ? [at.x, at.y, at.z] : null;
}

function worldPositionOfDragged(state: SceneState): Vec3 | null {
  const object = state.gizmo.object;
  if (!object || !pieceIdOf(object)) return null;
  const at = object.getWorldPosition(new THREE.Vector3());
  return [at.x, at.y, at.z];
}

/** Remember where a piece was when its move began. */
export function beginDragReadout(state: SceneState) {
  state.measure.dragFrom =
    state.gizmo.getMode() === "translate"
      ? worldPositionOfDragged(state)
      : null;
}

/** Report how far the piece has come from where the move began. */
export function moveDragReadout(state: SceneState) {
  const from = state.measure.dragFrom;
  const now = from ? worldPositionOfDragged(state) : null;
  if (!from || !now) return;
  state.measure.onDrag?.([
    now[0] - from[0],
    now[1] - from[1],
    now[2] - from[2],
  ]);
}

/** The readout goes with the drag. */
export function endDragReadout(state: SceneState) {
  if (state.measure.dragFrom) state.measure.onDrag?.(null);
  state.measure.dragFrom = null;
}
