// @vitest-environment happy-dom

/**
 * The move handle of a joined piece (issue #4295): two directions along the
 * face it slides on, turned to that face, and all three once Alt has freed it.
 */

import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { describe, expect, it } from "vitest";

import { type LegoPiece, type LegoProject, newProject } from "../../model";
import type { LegoPartInfo, LoadedPack } from "../../pack";
import type { SceneState } from "./sceneState";
import { attachPiece, draggedGroup } from "./slideHandle";

type Vec3 = [number, number, number];

function part(id: string, min: Vec3, max: Vec3): LegoPartInfo {
  return {
    id,
    packId: "lego",
    shapeId: id,
    name: id,
    category: "grey",
    colourway: "grey",
    shape: "block",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 0,
    iFirst: 0,
    iCount: 0,
    bbox: { min, max },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
}

function pack(): LoadedPack {
  const parts = [
    part("hull", [-1, -0.5, -2], [1, 0.5, 2]),
    part("leg", [-0.25, -1, -0.25], [0.25, 1, 0.25]),
  ];
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts,
    byId: new Map(parts.map((p) => [p.id, p])),
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  } as LoadedPack;
}

/** A leg joined to the hull's top face, with the hull turned a quarter about z. */
function turnedHull(joined = true): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  const piece = (extra: Partial<LegoPiece>): LegoPiece => ({
    id: "x",
    name: "x",
    parentId: "root",
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...extra,
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      piece({ id: "hull", partId: "hull", rotation: [0, 0, Math.PI / 2] }),
      piece({
        id: "leg",
        parentId: "hull",
        partId: "leg",
        position: [0, 1.5, 0],
        ...(joined ? { connection: { connector: "-y", to: "+y" } } : {}),
      }),
    ],
  };
}

function sceneFor(snapping: boolean, mode: "translate" | "rotate") {
  const hull = new THREE.Group();
  hull.rotation.set(0, 0, Math.PI / 2);
  const leg = new THREE.Group();
  leg.position.set(0, 1.5, 0);
  hull.add(leg);
  const root = new THREE.Group();
  root.add(hull);
  root.updateMatrixWorld(true);

  const gizmo = new TransformControls(
    new THREE.PerspectiveCamera(),
    document.createElement("canvas"),
  );
  gizmo.setMode(mode);
  const state = {
    gizmo,
    slideFrame: new THREE.Object3D(),
    snapping,
    packRef: { current: pack() },
    groups: new Map([
      ["hull", hull],
      ["leg", leg],
    ]),
  } as unknown as SceneState;
  return { state, hull, leg };
}

describe("attachPiece", () => {
  it("offers a joined piece the two axes along its face and not the one through it", () => {
    const { state, leg } = sceneFor(true, "translate");

    attachPiece(state, turnedHull(), "leg", leg);

    expect(state.gizmo.object).toBe(state.slideFrame);
    expect([state.gizmo.showX, state.gizmo.showY, state.gizmo.showZ]).toEqual([
      true,
      true,
      false,
    ]);
    expect([
      state.gizmo.showXY,
      state.gizmo.showYZ,
      state.gizmo.showXZ,
    ]).toEqual([true, false, false]);
  });

  it("turns the handle to the face, which is not aligned to the world or the piece", () => {
    const { state, leg } = sceneFor(true, "translate");

    attachPiece(state, turnedHull(), "leg", leg);

    // The through-face axis is the hull's up, which a quarter turn about z has
    // laid along the world's x. The piece's own axes are the parent's, so they
    // would not tell the two apart.
    const through = new THREE.Vector3(0, 0, 1).applyQuaternion(
      state.slideFrame.getWorldQuaternion(new THREE.Quaternion()),
    );
    expect(Math.abs(through.x)).toBeCloseTo(1, 6);
    expect(Math.abs(through.y)).toBeCloseTo(0, 6);
    expect(Math.abs(through.z)).toBeCloseTo(0, 6);
    expect(
      state.slideFrame.getWorldPosition(new THREE.Vector3()).toArray(),
    ).toEqual(leg.getWorldPosition(new THREE.Vector3()).toArray());
    expect(draggedGroup(state)).toBe(leg);
  });

  it("shows all three axes on the piece itself once Alt has freed it", () => {
    const { state, leg } = sceneFor(false, "translate");

    attachPiece(state, turnedHull(), "leg", leg);

    expect(state.gizmo.object).toBe(leg);
    expect([state.gizmo.showX, state.gizmo.showY, state.gizmo.showZ]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("leaves a piece that is not joined, or being turned, on its own group", () => {
    const free = sceneFor(true, "translate");
    attachPiece(free.state, turnedHull(false), "leg", free.leg);
    expect(free.state.gizmo.object).toBe(free.leg);

    const turning = sceneFor(true, "rotate");
    attachPiece(turning.state, turnedHull(), "leg", turning.leg);
    expect(turning.state.gizmo.object).toBe(turning.leg);
  });
});
