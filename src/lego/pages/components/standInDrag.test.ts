/**
 * Picking the stand-in up, carrying it across the ground and letting it go,
 * with playback leaving it where the game maker has it in the meantime.
 */

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { LegoProject } from "../../model";
import type { ScriptTimeline } from "../../scriptPlayback";
import type { SceneState } from "./sceneState";
import { grabStandIn, letGoOfStandIn, moveStandIn } from "./standInDrag";
import { placeStandIn } from "./standInPlayback";

const RADIUS = 5;

function scene(onLetGo?: (at: [number, number]) => void) {
  const standIn = new THREE.Group();
  standIn.position.set(0, 0, 50);
  standIn.visible = true;
  return {
    standIn,
    standInRadius: RADIUS,
    standInDrag: null,
    standInHeld: false,
    onStandInDragRef: { current: onLetGo },
    groundShape: null,
    controls: { enabled: true },
    render: vi.fn(),
  } as unknown as SceneState;
}

/** A ray from high above and behind the unit, through `to`. */
function rayAt(to: [number, number, number]): THREE.Raycaster {
  const from = new THREE.Vector3(0, 100, -100);
  const dir = new THREE.Vector3(...to).sub(from).normalize();
  return new THREE.Raycaster(from, dir);
}

describe("dragging the stand-in", () => {
  it("picks it up when the ray passes through it, and stops the orbit", () => {
    const state = scene(vi.fn());
    expect(grabStandIn(state, rayAt([0, 2, 50]))).toBe(true);
    expect(state.standInDrag).toEqual({ y: 0 });
    expect(state.controls.enabled).toBe(false);
  });

  it("does not pick it up when the ray misses it", () => {
    const state = scene(vi.fn());
    expect(grabStandIn(state, rayAt([40, 0, 50]))).toBe(false);
    expect(state.standInDrag).toBeNull();
    expect(state.controls.enabled).toBe(true);
  });

  /** A scenario whose stand-in cannot be moved gives no callback, and a
   *  stand-in that is not drawn is not there to grab. */
  it("does not pick up a stand-in nobody can move, or one not drawn", () => {
    expect(grabStandIn(scene(undefined), rayAt([0, 2, 50]))).toBe(false);
    const hidden = scene(vi.fn());
    hidden.standIn.visible = false;
    expect(grabStandIn(hidden, rayAt([0, 2, 50]))).toBe(false);
  });

  it("carries it to where the ray meets the ground, and says where it went", () => {
    const letGo = vi.fn();
    const state = scene(letGo);
    grabStandIn(state, rayAt([0, 2, 50]));
    moveStandIn(state, rayAt([-30, 0, 40]));
    expect(state.standIn.position.x).toBeCloseTo(-30);
    expect(state.standIn.position.z).toBeCloseTo(40);

    letGoOfStandIn(state);
    expect(state.standInDrag).toBeNull();
    expect(state.controls.enabled).toBe(true);
    const [at] = letGo.mock.calls[0];
    expect(at[0]).toBeCloseTo(-30);
    expect(at[1]).toBeCloseTo(40);
  });

  /** The run keeps playing during a drag, and on until the run with the new
   *  track arrives, so playback must not pull the stand-in back to the old
   *  track while either is happening. */
  it("is left where it is by playback while dragged and once let go", () => {
    const state = scene(vi.fn());
    const track = {
      keys: [{ frame: 0, pos: [0, 0, 10] as [number, number, number] }],
    };
    const placement = { track, attachPieces: new Map(), show: true };
    const project = { pieces: [] } as unknown as LegoProject;
    const timeline = { events: [] } as unknown as ScriptTimeline;

    grabStandIn(state, rayAt([0, 2, 50]));
    moveStandIn(state, rayAt([-30, 0, 40]));
    placeStandIn(state, project, placement, timeline, 3);
    expect(state.standIn.position.x).toBeCloseTo(-30);

    letGoOfStandIn(state);
    placeStandIn(state, project, placement, timeline, 4);
    expect(state.standIn.position.x).toBeCloseTo(-30);

    state.standInHeld = false;
    placeStandIn(state, project, placement, timeline, 5);
    expect(state.standIn.position.toArray()).toEqual([0, 0, 50]);
  });
});
