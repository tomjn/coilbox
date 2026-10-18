/**
 * A dot on the ground under each foot a fitted walk holds there (#3350), while
 * a walk plays. The marks come from `plantedFeet.ts`. A foot that stays on its
 * dot is planted, and one that slides off it is not.
 *
 * Drawn as the balance check draws a single foot's point, in the same green,
 * in `overlay` so a drive carries it with the unit. Never exported.
 */

import * as THREE from "three";
import type { PlantedFeet } from "../../plantedFeet";
import type { SceneState } from "./sceneState";

/** Lifted off y = 0 as the balance check's drawing is, so it does not fight
 *  the grid. */
const LIFT = 0.05;

/** The balance check's colour for a unit that stands. */
const COLOUR = 0x4ade80;

type PlantedState = Pick<SceneState, "overlay" | "planted">;

/** Show the marks for `frame`, or hide them when there are none. */
export function placePlanted(
  state: PlantedState,
  marks: PlantedFeet | null | undefined,
  frame: number,
): void {
  const held = marks?.[frame];
  if (!held || held.size === 0) {
    if (state.planted) state.planted.visible = false;
    return;
  }
  const spots = [...held.values()];
  let planted = state.planted;
  const room = planted?.geometry.getAttribute("position")?.count ?? 0;
  if (!planted || room < spots.length) {
    if (planted) disposePlanted(state);
    planted = new THREE.Points(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(new Float32Array(spots.length * 3), 3),
      ),
      new THREE.PointsMaterial({
        color: COLOUR,
        size: 6,
        sizeAttenuation: false,
        depthTest: false,
      }),
    );
    planted.renderOrder = 4;
    planted.raycast = () => {};
    planted.frustumCulled = false;
    state.overlay.add(planted);
    state.planted = planted;
  }
  const position = planted.geometry.getAttribute(
    "position",
  ) as THREE.BufferAttribute;
  spots.forEach(([x, z], index) => {
    position.setXYZ(index, x, LIFT, z);
  });
  position.needsUpdate = true;
  planted.geometry.setDrawRange(0, spots.length);
  planted.visible = true;
}

/** Free what `placePlanted` made. */
export function disposePlanted(state: PlantedState): void {
  const planted = state.planted;
  if (!planted) return;
  planted.geometry.dispose();
  (planted.material as THREE.Material).dispose();
  planted.removeFromParent();
  state.planted = null;
}
