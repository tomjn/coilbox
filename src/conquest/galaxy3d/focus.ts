import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { WorldPos } from "./layout";

/**
 * Camera focus: eases the camera in on a node (zoomed) when `focusRef`
 * names one, and back to the framed overview when cleared. While a node is
 * focused, user controls are locked. `tick` drives the ease itself (snapped
 * under reduce motion). A faction switch reuses the same tween to recentre
 * from the previous camera pose to the new framed overview, so the intro's
 * completion and the main loop's "who owns the camera" check both read
 * `isFocused`/`isAnimating` rather than the underlying state.
 */

const FOCUS_DIST = 30;
const FOCUS_MS = 650;

const easeOut = (t: number) => 1 - (1 - t) ** 3;

export interface Focus {
  /** Re-derive the camera/target goal from `focusRef.current` and start (or
   * snap, if `immediate`) the ease toward it. Locks/unlocks `controls`. */
  apply: (immediate: boolean) => void;
  /** Advance the focus/recentre tween. Call once per animation frame, only
   * while the intro isn't driving the camera itself. */
  tick: (now: number) => void;
  /** True once a node is focused (controls locked, no release since). Read
   * by the intro (to decide whether to hand controls back) and the main
   * loop (to decide whether controls own the camera this frame). */
  isFocused: () => boolean;
  /** True while the focus/recentre tween is in flight. Read alongside
   * `isFocused` by the main loop's camera-ownership check. */
  isAnimating: () => boolean;
}

export function createFocus(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  render: () => void,
  positions: Map<string, WorldPos>,
  focusRef: { current: string | null | undefined },
  framedTarget: THREE.Vector3,
  framedPos: THREE.Vector3,
  reduceMotion: boolean,
  factionOnlyRebuild: boolean,
  camPose: { pos: THREE.Vector3; target: THREE.Vector3 } | null,
): Focus {
  let focusAnim: {
    fromT: THREE.Vector3;
    toT: THREE.Vector3;
    fromP: THREE.Vector3;
    toP: THREE.Vector3;
    t0: number;
  } | null = null;
  let focusShown: string | null = focusRef.current ?? null;

  const focusGoal = (id: string | null) => {
    const p = id ? positions.get(id) : undefined;
    if (p) {
      const target = new THREE.Vector3(p[0], p[1], p[2]);
      const dir = framedPos.clone().sub(framedTarget).normalize();
      return { target, pos: target.clone().addScaledVector(dir, FOCUS_DIST) };
    }
    return { target: framedTarget.clone(), pos: framedPos.clone() };
  };

  const apply = (immediate: boolean) => {
    const id = focusRef.current ?? null;
    // No change (e.g. the mount-time effect firing with no focus) must not
    // spawn an ease that fights the intro.
    if (!immediate && id === focusShown) return;
    focusShown = id;
    // Releasing focus (a node was selected, or empty space clicked): unlock
    // controls and stay at the current pose. Flying back to the framed
    // overview here read as "undoing" the fly-in the user just triggered.
    if (!id) {
      focusAnim = null;
      controls.enabled = true;
      return;
    }
    const goal = focusGoal(id);
    controls.enabled = false;
    if (immediate || reduceMotion) {
      controls.target.copy(goal.target);
      camera.position.copy(goal.pos);
      controls.update();
      focusAnim = null;
      render();
      return;
    }
    focusAnim = {
      fromT: controls.target.clone(),
      toT: goal.target,
      fromP: camera.position.clone(),
      toP: goal.pos,
      t0: performance.now(),
    };
  };

  const tick = (now: number) => {
    if (!focusAnim) return;
    const e = easeOut(Math.min(1, (now - focusAnim.t0) / FOCUS_MS));
    controls.target.lerpVectors(focusAnim.fromT, focusAnim.toT, e);
    camera.position.lerpVectors(focusAnim.fromP, focusAnim.toP, e);
    // Track the moving target so the orientation doesn't snap at the end.
    camera.lookAt(controls.target);
    if (e >= 1) focusAnim = null;
  };

  // A node focused at mount (rare) snaps. Otherwise the intro/overview runs.
  if (focusShown) {
    apply(true);
  } else if (factionOnlyRebuild && !reduceMotion && camPose) {
    // A faction switch rebuilds the scene with a new focus centroid: start
    // from the previous camera pose and ease to the new framed overview so
    // the recentre is a transition, not a jump.
    camera.position.copy(camPose.pos);
    controls.target.copy(camPose.target);
    focusAnim = {
      fromT: camPose.target.clone(),
      toT: framedTarget.clone(),
      fromP: camPose.pos.clone(),
      toP: framedPos.clone(),
      t0: performance.now(),
    };
  }

  return {
    apply,
    tick,
    isFocused: () => !!focusShown,
    isAnimating: () => !!focusAnim,
  };
}
