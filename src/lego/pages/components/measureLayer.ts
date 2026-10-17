/**
 * The measure tool in the scene: the lines it draws, the point a click lands
 * on, and how far a dragged piece has moved.
 *
 * Everything here is a view aid. It is drawn in `overlay`, so it is never part
 * of the unit and never exported, and nothing is saved with the document.
 */

import * as THREE from "three";

import type { Measurement } from "../../measure";
import type { Vec3 } from "../../snapping";
import { dotMaterial, points } from "./dotsAndPoints";
import { pieceIdOf } from "./gizmoCommit";
import type { SceneState } from "./sceneState";

export const MEASURE_COLOUR = 0x22d3ee;
const MEASURE_DOT = 9;

/** What the scene keeps for the measure tool and the drag readout. The React
 *  side fills in the callbacks, since the scene is built once. */
export interface MeasureScene {
  /** Whether a click measures rather than selects. */
  active: boolean;
  /** Told the point a click chose, after snapping. */
  onPick?: (at: Vec3) => void;
  /** Told where the pointer is while measuring, after snapping, or null when
   *  it leaves the model and the ground. */
  onHover?: (at: Vec3 | null) => void;
  /** Told how far the dragged piece is from where the drag began, or null once
   *  it is let go. */
  onDrag?: (moved: Vec3 | null) => void;
  /** Where the dragged piece was when the drag began. */
  dragFrom: Vec3 | null;
  /** The lines now drawn, or null when there are none. */
  layer: THREE.Group | null;
}

export function newMeasureScene(): MeasureScene {
  return { active: false, dragFrom: null, layer: null };
}

/** Free what the lines own and take them out of the scene. */
export function disposeMeasure(state: SceneState) {
  const layer = state.measure.layer;
  if (!layer) return;
  layer.traverse((object) => {
    if (object instanceof THREE.Line || object instanceof THREE.Points) {
      object.geometry.dispose();
      const material = object.material;
      for (const m of Array.isArray(material) ? material : [material]) {
        m.dispose();
      }
    }
  });
  layer.removeFromParent();
  state.measure.layer = null;
}

/**
 * Draw every measurement as a line with a dot at each end, and the one being
 * made as a line to the pointer. Drawn over the model, since a measurement
 * across a part would otherwise vanish into it.
 */
export function drawMeasurements(
  state: SceneState,
  measurements: Measurement[],
  pending: { from: Vec3; to: Vec3 | null } | null,
) {
  disposeMeasure(state);
  const ends: number[] = [];
  const lines: number[] = [];
  const add = (from: Vec3, to: Vec3 | null) => {
    ends.push(...from);
    if (!to) return;
    ends.push(...to);
    lines.push(...from, ...to);
  };
  for (const m of measurements) add(m.from, m.to);
  if (pending) add(pending.from, pending.to);

  if (ends.length > 0) {
    const layer = new THREE.Group();
    layer.name = "measurements";
    if (lines.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(lines, 3),
      );
      const segments = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({
          color: MEASURE_COLOUR,
          depthTest: false,
          transparent: true,
        }),
      );
      segments.renderOrder = 3;
      segments.raycast = () => {};
      layer.add(segments);
    }
    layer.add(
      points(
        ends,
        null,
        dotMaterial(
          MEASURE_DOT,
          state.renderer.getPixelRatio(),
          false,
          MEASURE_COLOUR,
        ),
      ),
    );
    state.overlay.add(layer);
    state.measure.layer = layer;
  }
  state.render();
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
