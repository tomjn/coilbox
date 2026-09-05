import * as THREE from "three";

import { buildGround, disposeGround, groundSteps } from "../../buildPlate";
import { frameBox } from "../../framing";
import { type UnitBounds, unitBounds } from "../../s3oBuild";
import type { Vec3 } from "../../snapping";
import {
  HOME_CAMERA,
  MIN_FAR,
  MIN_MAX_DISTANCE,
  ZOOM_OUT_PADDING,
} from "./ModelViewport";
import type { SceneState } from "./sceneState";

/**
 * Frame the selection: move the orbit target to the box round everything in
 * it, and pull the camera in along the direction it is already looking.
 *
 * With nothing selected the whole unit is framed instead. That reads as more
 * useful than F doing nothing, and matches other 3D tools' "frame all"
 * behaviour for an empty selection.
 *
 * A unit with no geometry in it at all has nothing to frame, whatever is
 * selected, so the camera goes home instead: the same place the compass puts
 * it, and for the same reason. Measuring the scene made this case look like a
 * unit the size of a point at the origin, because a selected piece's pivot dot
 * is in the scene as well as its geometry, and F dived at the dot. The
 * document's own box has no dots in it, and no reference figure either: the
 * figure stands beside the unit for scale and is not the work being framed.
 */
export function focusSelection(state: SceneState, pieceIds: string[]) {
  const unit = boundsBox(
    unitBounds(
      state.projectRef.current,
      state.packRef.current,
      state.rawRef.current,
    ),
  );
  if (!unit) {
    homeView(state);
    state.render();
    return;
  }

  const groups = pieceIds
    .map((id) => state.groups.get(id))
    .filter((group): group is THREE.Group => group !== undefined);
  if (groups.length === 0) {
    if (frameBounds(state, unit)) state.render();
    return;
  }

  const box = new THREE.Box3();
  for (const group of groups) box.union(new THREE.Box3().setFromObject(group));
  if (frameBounds(state, box)) state.render();
}

/**
 * Move the orbit target to `object`'s world-space bounding box and pull the
 * camera in along the direction it is already looking. Returns false, leaving
 * the camera untouched, when the box is empty: an object with no geometry
 * (an empty piece, or a unit that is only empty pieces) has nothing to frame.
 *
 * Used by the opening frame, which frames the whole unit once as soon as its
 * geometry exists.
 */
export function frameObject(
  state: SceneState,
  object: THREE.Object3D,
): boolean {
  return frameBounds(state, new THREE.Box3().setFromObject(object));
}

/** The view the builder opens on: the home camera, looking at the origin.
 *  Where the camera lands when there is nothing to frame. */
export function homeView(state: SceneState) {
  state.camera.position.set(...HOME_CAMERA);
  state.controls.target.set(0, 0, 0);
  state.controls.update();
}

/** The unit's own measured box, or null when it has no geometry to frame: a
 *  unit with no vertices measures zero on every axis. */
export function boundsBox(bounds: UnitBounds): THREE.Box3 | null {
  if (bounds.sizeX === 0 && bounds.sizeY === 0 && bounds.sizeZ === 0) {
    return null;
  }
  return new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(...bounds.mid),
    new THREE.Vector3(bounds.sizeX, bounds.sizeY, bounds.sizeZ),
  );
}

/** The same, from a box that is already worked out: framing a set unions the
 *  boxes of several pieces rather than taking one object's own. `from` is the
 *  direction to look from when the caller wants a set one, and defaults to the
 *  direction the camera is already looking. */
export function frameBounds(
  state: SceneState,
  box: THREE.Box3,
  from?: Vec3,
): boolean {
  if (box.isEmpty()) return false;

  // The direction from the target to the camera, not the camera to the
  // target: keeping this fixed and only moving the target and the distance
  // along it is what stops framing from spinning the view to a new angle.
  const offset = new THREE.Vector3().subVectors(
    state.camera.position,
    state.controls.target,
  );

  const { target, position } = frameBox(
    {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    },
    from ?? [offset.x, offset.y, offset.z],
    THREE.MathUtils.degToRad(state.camera.fov),
  );

  state.controls.target.set(...target);
  state.camera.position.set(...position);
  state.controls.update();
  return true;
}

/**
 * Size the camera's reach and the ground's to what is actually in the scene:
 * the unit being built, and whatever reference figure is standing beside it.
 *
 * Both used to be constants picked when the only reference was a solar
 * collector, 43 elmos across. A figure read out of an installed game is any
 * size at all, and the big ones are far bigger than that: Balanced
 * Annihilation's Krogoth gantry is 125 elmos wide, its Buzzsaw 190 tall. At
 * the old limits neither could be got fully in shot, and the gantry stood off
 * the end of the ground it is there to be measured against.
 *
 * Called whenever the unit or the figure changes, which is cheap: it measures
 * two bounding boxes and only lays the ground again when the answer crosses a
 * whole footprint step.
 */
export function applySceneScale(state: SceneState) {
  const box = new THREE.Box3().setFromObject(state.root);
  // Only when it is standing. A figure that has been picked but switched off
  // is not in the scene, and should not stretch the ground out under nothing.
  if (state.reference.visible) {
    box.union(new THREE.Box3().setFromObject(state.reference));
  }
  if (box.isEmpty()) return;

  // Measured from the world origin rather than from the box's own middle,
  // because the orbit target sits on the unit, which is built at the origin,
  // not on the middle of a scene a reference has pulled off to one side.
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = sphere.center.length() + sphere.radius;

  const fit = radius / Math.sin(THREE.MathUtils.degToRad(state.camera.fov) / 2);
  state.controls.maxDistance = Math.max(
    MIN_MAX_DISTANCE,
    fit * ZOOM_OUT_PADDING,
  );
  // The ground is flat, so only how far the scene spreads matters here, not
  // how tall it stands.
  layGround(state, Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z, 0));

  // Far enough to still draw the far side of the scene from the furthest back
  // the camera can now get. Measured against the ground too, not just what
  // stands on it: the ground is always the wider of the two, so its far corner
  // is what the far plane cuts off first. It is centred on the origin, so its
  // bounding sphere's radius is that corner's distance.
  const ground = new THREE.Box3()
    .setFromObject(state.grid)
    .getBoundingSphere(new THREE.Sphere()).radius;
  state.camera.far = Math.max(
    MIN_FAR,
    state.controls.maxDistance + Math.max(radius, ground),
  );
  state.camera.updateProjectionMatrix();
}

/** Lay the ground again when it has to reach further than it does. Skipped
 *  whenever the step count is unchanged, which is nearly always: each plate
 *  carries a label drawn on its own canvas. */
function layGround(state: SceneState, reachElmos: number) {
  const steps = groundSteps(reachElmos);
  if (steps === state.groundSteps) return;
  state.groundSteps = steps;

  const { visible } = state.grid;
  state.scene.remove(state.grid);
  disposeGround(state.grid);
  state.grid = buildGround(reachElmos);
  state.grid.visible = visible;
  state.scene.add(state.grid);
}
