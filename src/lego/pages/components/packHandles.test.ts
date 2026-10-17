/**
 * The face drag on a pack block, against a scene with real three.js objects and
 * a hand-made state: only what the drag reads is filled in.
 */

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { type LegoProject, newProject } from "../../model";
import type { LegoPartInfo, LoadedPack } from "../../pack";
import { buildCollisionHandles } from "./collisionHandles";
import {
  beginPackDrag,
  buildPackPreview,
  endPackDrag,
  movePackDrag,
  packSubject,
  showPackHandles,
} from "./packHandles";
import type { SceneState } from "./sceneState";

type Vec3 = [number, number, number];

function part(id: string, size: Vec3, extra: Partial<LegoPartInfo> = {}) {
  return {
    id,
    packId: "lego",
    shapeId: id,
    name: id,
    category: "green",
    colourway: "green",
    shape: "block",
    material: "metal",
    tags: [],
    bbox: {
      min: size.map((n) => -n / 2),
      max: size.map((n) => n / 2),
    },
    ...extra,
  } as LegoPartInfo;
}

function setup(rotationY = 0) {
  const parts = [
    part("z1", [1, 1, 1]),
    part("z2", [1, 1, 2]),
    part("z3", [1, 1, 3]),
    part("lone", [4, 4, 4]),
  ];
  const pack = {
    manifest: { unit: 0.25 },
    parts,
    byId: new Map(parts.map((p) => [p.id, p])),
  } as unknown as LoadedPack;
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "u",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  const project: LegoProject = {
    ...base,
    pieces: [
      ...base.pieces,
      {
        id: "a",
        name: "a",
        parentId: "root",
        partId: "z2",
        position: [0, 0, 0],
        rotation: [0, rotationY, 0],
        scale: [1, 1, 1],
      },
    ],
  };
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.rotation.y = rotationY;
  scene.add(group);
  const handleMaterial = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
  });
  const camera = new THREE.PerspectiveCamera();
  const resized = vi.fn();
  const readout = vi.fn();
  const state = {
    scene,
    camera,
    controls: { enabled: true },
    gizmo: { getMode: () => "scale" },
    uniformScale: false,
    editAim: false,
    editCollision: false,
    editPieceId: null,
    pieceCollisionBoxes: new Map(),
    collision: null,
    placingAnchorRef: { current: false },
    selectedIdsRef: { current: ["a"] },
    groupIds: ["a"],
    groups: new Map([["a", group]]),
    projectRef: { current: project },
    packRef: { current: pack },
    packHandles: buildCollisionHandles(handleMaterial),
    packHandleMaterial: handleMaterial,
    packHandleHotMaterial: new THREE.MeshBasicMaterial(),
    packPreview: buildPackPreview(new THREE.LineBasicMaterial()),
    packDrag: null,
    onPackResizeRef: { current: resized },
    onPackReadoutRef: { current: readout },
    render: vi.fn(),
  } as unknown as SceneState;
  scene.add(state.packHandles);
  return { state, resized, readout, camera };
}

/** A ray from `from` through `to`. */
function ray(from: Vec3, to: Vec3): THREE.Raycaster {
  const origin = new THREE.Vector3(...from);
  return new THREE.Raycaster(
    origin,
    new THREE.Vector3(...to).sub(origin).normalize(),
  );
}

describe("packSubject", () => {
  it("is the selected pack block in scale mode", () => {
    expect(packSubject(setup().state)?.id).toBe("a");
  });

  it("is nothing in another mode", () => {
    const { state } = setup();
    (state.gizmo as unknown as { getMode: () => string }).getMode = () =>
      "translate";
    expect(packSubject(state)).toBeNull();
  });

  it("is nothing while the uniform scale lock is on", () => {
    const { state } = setup();
    state.uniformScale = true;
    expect(packSubject(state)).toBeNull();
  });

  it("is nothing for two selected pieces", () => {
    const { state } = setup();
    state.selectedIdsRef.current = ["a", "root"];
    expect(packSubject(state)).toBeNull();
  });

  it("is nothing when the page gives no way to resize", () => {
    const { state } = setup();
    state.onPackResizeRef.current = undefined;
    expect(packSubject(state)).toBeNull();
  });

  it("is nothing for a piece with no pack part", () => {
    const { state } = setup();
    state.selectedIdsRef.current = ["root"];
    state.groupIds = ["root"];
    expect(packSubject(state)).toBeNull();
  });
});

describe("showPackHandles", () => {
  it("puts a plate on each face of the block", () => {
    const { state } = setup();
    showPackHandles(state);
    expect(state.packHandles.visible).toBe(true);
    const front = state.packHandles.children.find(
      (c) => c.userData.axis === 2 && c.userData.sign === 1,
    );
    expect(front?.position.toArray()).toEqual([0, 0, 1]);
  });

  it("hides them when nothing is a block", () => {
    const { state } = setup();
    state.uniformScale = true;
    showPackHandles(state);
    expect(state.packHandles.visible).toBe(false);
  });
});

describe("a face drag", () => {
  /** The camera sits on +x looking at the block, so z runs across the screen. */
  function grabFront(rotationY = 0) {
    const s = setup(rotationY);
    s.camera.position.set(10, 0, 0);
    s.camera.lookAt(0, 0, 0);
    s.camera.updateMatrixWorld(true);
    showPackHandles(s.state);
    s.state.packHandles.updateMatrixWorld(true);
    return s;
  }

  it("asks for the pack part of the size dragged to", () => {
    const { state, resized, readout } = grabFront();
    expect(beginPackDrag(state, ray([10, 0, 0], [0, 0, 1]))).toBe(true);
    expect(state.controls.enabled).toBe(false);
    movePackDrag(state, ray([10, 0, 0], [0, 0, 2]));
    expect(readout).toHaveBeenLastCalledWith("3 elmos, 12 units");
    endPackDrag(state);
    expect(resized).toHaveBeenCalledWith("a", 2, 1, 3);
    expect(state.controls.enabled).toBe(true);
    expect(readout).toHaveBeenLastCalledWith(null);
  });

  it("snaps to the nearest size the pack has", () => {
    const { state, resized, readout } = grabFront();
    beginPackDrag(state, ray([10, 0, 0], [0, 0, 1]));
    movePackDrag(state, ray([10, 0, 0], [0, 0, 1.7]));
    expect(readout).toHaveBeenLastCalledWith("Snapped to 3 elmos, 12 units");
    endPackDrag(state);
    expect(resized).toHaveBeenCalledWith("a", 2, 1, 3);
  });

  it("drags the low face the other way round", () => {
    const { state, resized } = grabFront();
    expect(beginPackDrag(state, ray([10, 0, 0], [0, 0, -1]))).toBe(true);
    movePackDrag(state, ray([10, 0, 0], [0, 0, -2]));
    endPackDrag(state);
    expect(resized).toHaveBeenCalledWith("a", 2, -1, 3);
  });

  it("shortens when the face is pushed in", () => {
    const { state, resized } = grabFront();
    beginPackDrag(state, ray([10, 0, 0], [0, 0, 1]));
    movePackDrag(state, ray([10, 0, 0], [0, 0, 0.1]));
    endPackDrag(state);
    expect(resized).toHaveBeenCalledWith("a", 2, 1, 1);
  });

  it("makes no edit for a press that stays on the same size", () => {
    const { state, resized } = grabFront();
    beginPackDrag(state, ray([10, 0, 0], [0, 0, 1]));
    movePackDrag(state, ray([10, 0, 0], [0, 0, 1.2]));
    endPackDrag(state);
    expect(resized).not.toHaveBeenCalled();
  });

  it("says when the pack has nothing longer", () => {
    const { state, readout } = grabFront();
    beginPackDrag(state, ray([10, 0, 0], [0, 0, 1]));
    movePackDrag(state, ray([10, 0, 0], [0, 0, 9]));
    expect(readout).toHaveBeenLastCalledWith(
      "No longer part in the pack. Longest is 3 elmos, 12 units",
    );
  });

  it("outlines the part it would swap to, with the other face still", () => {
    const { state } = grabFront();
    beginPackDrag(state, ray([10, 0, 0], [0, 0, 1]));
    movePackDrag(state, ray([10, 0, 0], [0, 0, 2.6]));
    expect(state.packPreview.visible).toBe(true);
    expect(state.packPreview.scale.toArray()).toEqual([1, 1, 3]);
    expect(state.packPreview.position.toArray()).toEqual([0, 0, 0.5]);
    endPackDrag(state);
    expect(state.packPreview.visible).toBe(false);
  });

  it("follows the piece's own axis when it is turned", () => {
    // Turned a quarter about y, the block's z runs along the world's x.
    const { state, resized, camera } = setup(Math.PI / 2);
    camera.position.set(0, 10, 0.001);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    showPackHandles(state);
    state.packHandles.updateMatrixWorld(true);
    expect(beginPackDrag(state, ray([0, 10, 0], [1, 0, 0]))).toBe(true);
    movePackDrag(state, ray([0, 10, 0], [2, 0, 0]));
    endPackDrag(state);
    expect(resized).toHaveBeenCalledWith("a", 2, 1, 3);
  });

  it("does not start on a press that misses the plates", () => {
    const { state } = grabFront();
    expect(beginPackDrag(state, ray([10, 0, 0], [0, 0, 5]))).toBe(false);
    expect(state.packDrag).toBeNull();
  });

  it("says there is no other size when the pack has one", () => {
    const { state, readout } = grabFront();
    state.projectRef.current = {
      ...state.projectRef.current,
      pieces: state.projectRef.current.pieces.map((p) =>
        p.id === "a" ? { ...p, partId: "lone" } : p,
      ),
    };
    showPackHandles(state);
    state.packHandles.updateMatrixWorld(true);
    expect(beginPackDrag(state, ray([10, 0, 0], [0, 0, 2]))).toBe(true);
    expect(readout).toHaveBeenLastCalledWith(
      "No other size in the pack on this axis",
    );
    movePackDrag(state, ray([10, 0, 0], [0, 0, 6]));
    endPackDrag(state);
    expect(state.onPackResizeRef.current).not.toHaveBeenCalled();
  });
});
