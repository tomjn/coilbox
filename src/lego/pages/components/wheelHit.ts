/**
 * Whether the pointer is over something the builder view is showing, for the
 * wheel gate (issue #2328).
 *
 * "Something" is the unit and the ground it stands on. The ground is the grid
 * or whichever surface replaces it, all flat at y = 0 as far as this is
 * concerned, so it is one ray against one plane and the surface's extent. The
 * unit is the box `applySceneScale` last measured. Both are constant time, which
 * a raycast against the unit's pieces is not.
 */

import type * as THREE from "three";
import { boxHit, groundHit } from "@/mapconv/pages/components/wheelGate";
import { ELMOS_PER_FOOTPRINT } from "../../unitDef";
import type { SceneState } from "./sceneState";

/** How far the ground reaches from the origin along x and z, or 0 with none
 *  showing. The widest of the grid and the surfaces on it, since a terrain or
 *  a sea is drawn under the grid and well past it. */
export function groundReach(
  state: Pick<
    SceneState,
    "grid" | "groundSteps" | "terrain" | "water" | "shaped"
  >,
): number {
  let reach = state.grid.visible ? state.groundSteps * ELMOS_PER_FOOTPRINT : 0;
  for (const mesh of [state.terrain, state.water, state.shaped]) {
    // Only a surface in the scene is showing: the others are kept for later.
    if (!mesh?.parent) continue;
    const { width } = (mesh.geometry as THREE.PlaneGeometry).parameters;
    reach = Math.max(reach, (width / 2) * mesh.scale.x);
  }
  return reach;
}

export function viewportHit(
  state: Pick<
    SceneState,
    "grid" | "groundSteps" | "terrain" | "water" | "shaped" | "contentBox"
  >,
  ray: THREE.Ray,
): boolean {
  const reach = groundReach(state);
  return (
    groundHit(ray.origin, ray.direction, 0, reach, reach) ||
    boxHit(
      ray.origin,
      ray.direction,
      state.contentBox.min,
      state.contentBox.max,
    )
  );
}
