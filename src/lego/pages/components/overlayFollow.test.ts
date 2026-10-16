import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { LegoProject } from "../../model";
import type { ScriptTimeline } from "../../scriptPlayback";
import { applyTimelineFrame, restoreFromPlayback } from "./animationPlayback";
import { refreshSelection } from "./overlayFollow";
import type { SceneState } from "./sceneState";

/**
 * A body at the origin and an arm 10 elmos out from it, each with a unit cube,
 * the arm selected, hovered and given a piece box, and the whole unit given a
 * volume of its own.
 */
function scene() {
  const root = new THREE.Group();
  const overlay = new THREE.Group();
  const groups = new Map<string, THREE.Group>();
  const rest = new Map<string, [number, number, number]>();
  for (const [id, at] of [
    ["body", [0, 0, 0]],
    ["arm", [10, 0, 0]],
  ] as const) {
    const group = new THREE.Group();
    group.position.set(at[0], at[1], at[2]);
    group.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)));
    (id === "arm" ? groups.get("body") : undefined)?.add(group);
    if (id === "body") root.add(group);
    groups.set(id, group);
    rest.set(id, [at[0], at[1], at[2]]);
  }
  const arm = groups.get("arm") as THREE.Group;

  const box = new THREE.LineSegments(new THREE.BufferGeometry());
  box.position.set(10, 0, 0);
  box.scale.set(4, 4, 4);
  box.userData.origin = new THREE.Vector3(10, 0, 0);
  overlay.add(box);
  const unit = new THREE.LineSegments(new THREE.BufferGeometry());
  unit.position.set(5, 0, 0);
  overlay.add(unit);

  const selectOutline = new THREE.BoxHelper(arm);
  const hoverOutline = new THREE.BoxHelper(arm);
  hoverOutline.visible = true;
  const state = {
    root,
    overlay,
    groups,
    rest,
    drive: null,
    restTilt: new THREE.Quaternion(),
    selectedGroups: [arm],
    selectOutlines: [selectOutline],
    selectOverlays: [new THREE.Mesh(new THREE.BufferGeometry())],
    hoveredId: "arm",
    hoverOutline,
    hoverOverlay: new THREE.Mesh(new THREE.BufferGeometry()),
    pieceCollisionBoxes: new Map([["arm", box]]),
  } as unknown as SceneState;
  return { state, arm, box, unit, selectOutline, hoverOutline };
}

const project = {
  pieces: [
    { id: "body", name: "body" },
    { id: "arm", name: "arm" },
  ],
} as unknown as LegoProject;

/** One frame with the body still and the arm moved by `move` and turned by
 *  `turn` about y. */
function timeline(move: number, turn = 0): ScriptTimeline {
  return {
    fps: 30,
    pieces: ["body", "arm"],
    frames: [[0, 0, 0, 0, 0, 0, move, 0, 0, 0, turn, 0]],
    hidden: [],
  } as unknown as ScriptTimeline;
}

function worldCentre(box: THREE.Box3Helper | THREE.BoxHelper) {
  return new THREE.Box3().setFromObject(box).getCenter(new THREE.Vector3());
}

function placed(state: SceneState, object: THREE.Object3D) {
  state.overlay.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
}

describe("overlays while a script poses the pieces", () => {
  it("moves the selected piece's outline with the piece", () => {
    const { state, selectOutline } = scene();
    applyTimelineFrame(state, project, timeline(5), 0);
    expect(worldCentre(selectOutline).x).toBeCloseTo(15);
  });

  it("moves the hovered piece's outline with the piece", () => {
    const { state, hoverOutline } = scene();
    applyTimelineFrame(state, project, timeline(5), 0);
    expect(worldCentre(hoverOutline).x).toBeCloseTo(15);
  });

  it("moves a piece's collision box with the piece", () => {
    const { state, box } = scene();
    applyTimelineFrame(state, project, timeline(5), 0);
    expect(placed(state, box).x).toBeCloseTo(15);
  });

  it("turns a piece's collision box with the piece", () => {
    const { state, box } = scene();
    // The box's own corner is 2 elmos from its middle along x, so a quarter
    // turn about the piece's origin carries it onto z.
    applyTimelineFrame(state, project, timeline(0, Math.PI / 2), 0);
    box.updateMatrixWorld(true);
    const corner = new THREE.Vector3(0.5, 0, 0).applyMatrix4(box.matrixWorld);
    expect(corner.x).toBeCloseTo(10);
    expect(corner.z).toBeCloseTo(-2);
  });

  it("leaves the whole unit's volume with the root", () => {
    const { state, unit } = scene();
    applyTimelineFrame(state, project, timeline(5, 1), 0);
    expect(placed(state, unit).x).toBeCloseTo(5);
  });

  it("puts the boxes back when playback stops", () => {
    const { state, box, selectOutline } = scene();
    applyTimelineFrame(state, project, timeline(5), 0);
    // What the scene rebuild does to the pieces on the way out.
    for (const [id, group] of state.groups) {
      group.position.set(...(state.rest.get(id) as [number, number, number]));
      group.rotation.set(0, 0, 0);
    }
    restoreFromPlayback(state);
    refreshSelection(state);
    expect(box.matrixAutoUpdate).toBe(true);
    expect(placed(state, box).x).toBeCloseTo(10);
    expect(worldCentre(selectOutline).x).toBeCloseTo(10);
  });
});
