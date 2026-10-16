import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { DriveFrame } from "../../drive";
import { groundHeight } from "../../environment";
import {
  drawDrivePath,
  followCamera,
  pickGround,
  poseRoot,
  restoreFromDrive,
  setDrive,
} from "./drivePlayback";
import type { SceneState } from "./sceneState";

function scene(frames: DriveFrame[] | null) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 50, -100);
  return {
    root: new THREE.Group(),
    drive: frames,
    restTilt: new THREE.Quaternion(),
    follow: true,
    followAt: null,
    followOffset: new THREE.Vector3(),
    camera,
    controls: { target: new THREE.Vector3(), update: () => {} },
    drivePath: new THREE.Group(),
    groundShape: null,
    shaped: null,
  } as unknown as SceneState;
}

const frame = (over: Partial<DriveFrame>): DriveFrame => ({
  pos: [0, 0, 0],
  heading: 0,
  speed: 0,
  up: null,
  ...over,
});

/** Where a point in the unit's own space ends up once the root is posed. */
function placed(state: SceneState, at: [number, number, number]) {
  state.root.updateMatrixWorld(true);
  return new THREE.Vector3(...at).applyMatrix4(state.root.matrixWorld);
}

describe("poseRoot", () => {
  it("moves and turns the unit to where the drive has it", () => {
    const state = scene([frame({ pos: [100, 0, 50], heading: 16384 })]);
    poseRoot(state, 0);
    // A quarter turn left faces +x, so its nose is there.
    const nose = placed(state, [0, 0, 10]);
    expect(nose.x).toBeCloseTo(110);
    expect(nose.z).toBeCloseTo(50);
  });

  /** Turned about straight up first, then tilted to the ground, as
   *  `UpdateDirVectors` does. Facing +x across a slope that rises to +z, the
   *  nose stays level and the top leans downhill. */
  it("turns before it tilts", () => {
    const angle = (30 * Math.PI) / 180;
    const state = scene([
      frame({ heading: 16384, up: [0, Math.cos(angle), -Math.sin(angle)] }),
    ]);
    poseRoot(state, 0);
    const nose = placed(state, [0, 0, 10]);
    expect(nose.x).toBeCloseTo(10);
    expect(nose.y).toBeCloseTo(0);
    const top = placed(state, [0, 10, 0]);
    expect(top.y).toBeCloseTo(10 * Math.cos(angle));
    expect(top.z).toBeCloseTo(-10 * Math.sin(angle));
  });

  /** A scenario switched from the drive to another while it plays puts the
   *  unit back at the origin, standing as it does when nothing drives it. */
  it("goes back to the origin in its resting tilt when the drive ends", () => {
    const state = scene([frame({ pos: [30, 2, 40], heading: 900 })]);
    state.restTilt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2);
    poseRoot(state, 0);
    setDrive(state, null);
    expect(state.root.position.toArray()).toEqual([0, 0, 0]);
    expect(state.root.quaternion.equals(state.restTilt)).toBe(true);
    // With nothing driving it, posing a frame leaves it alone.
    poseRoot(state, 0);
    expect(state.root.position.toArray()).toEqual([0, 0, 0]);
  });
});

describe("followCamera", () => {
  it("moves the camera with the unit, then puts it back", () => {
    const state = scene([
      frame({ pos: [0, 0, 0] }),
      frame({ pos: [0, 0, 30] }),
    ]);
    poseRoot(state, 0);
    followCamera(state);
    poseRoot(state, 1);
    followCamera(state);
    expect(state.camera.position.toArray()).toEqual([0, 50, -70]);
    expect(state.controls.target.toArray()).toEqual([0, 0, 30]);

    restoreFromDrive(state);
    expect(state.camera.position.toArray()).toEqual([0, 50, -100]);
    expect(state.controls.target.toArray()).toEqual([0, 0, 0]);
    expect(state.root.position.toArray()).toEqual([0, 0, 0]);
  });

  it("leaves the camera where it is when it is not following", () => {
    const state = scene([frame({ pos: [0, 0, 30] })]);
    state.follow = false;
    poseRoot(state, 0);
    followCamera(state);
    expect(state.camera.position.toArray()).toEqual([0, 50, -100]);
  });
});

describe("drawDrivePath", () => {
  it("draws the path on the ground, through every waypoint", () => {
    const shape = { kind: "slope" as const, degrees: 20 };
    const state = scene(null);
    drawDrivePath(
      state,
      [
        [0, 40],
        [-40, 40],
      ],
      shape,
    );
    expect(state.drivePath.visible).toBe(true);
    const line = state.drivePath.children[0] as THREE.Line;
    const at = line.geometry.getAttribute("position");
    for (let i = 0; i < at.count; i++) {
      expect(at.getY(i)).toBeCloseTo(
        groundHeight(shape, at.getX(i), at.getZ(i)) + 0.5,
      );
    }
    const dots = state.drivePath.children[1] as THREE.Points;
    expect(dots.geometry.getAttribute("position").count).toBe(2);

    drawDrivePath(state, [], shape);
    expect(state.drivePath.visible).toBe(false);
    expect(state.drivePath.children).toHaveLength(0);
  });
});

describe("pickGround", () => {
  it("finds where a ray meets flat ground", () => {
    const ray = new THREE.Raycaster(
      new THREE.Vector3(10, 100, 20),
      new THREE.Vector3(0, -1, 0),
    );
    expect(pickGround(scene(null), ray)).toEqual([10, 20]);
  });

  it("misses when the ray points away from the ground", () => {
    const ray = new THREE.Raycaster(
      new THREE.Vector3(10, 100, 20),
      new THREE.Vector3(0, 1, 0),
    );
    expect(pickGround(scene(null), ray)).toBeNull();
  });
});
