import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { type LegoPiece, type LegoProject, newProject } from "../../model";
import type { LegoPartInfo, LoadedPack } from "../../pack";
import { applySnap } from "./anchorsAndSnapping";
import type { SceneState } from "./sceneState";

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

const parts = [
  part("hull", [-1, -0.5, -2], [1, 0.5, 2]),
  part("leg", [-0.25, -1, -0.25], [0.25, 1, 0.25]),
];
const pack = {
  manifest: {},
  parts,
  byId: new Map(parts.map((p) => [p.id, p])),
} as unknown as LoadedPack;

function piece(id: string, partId: string | null, extra: Partial<LegoPiece>) {
  return {
    id,
    name: id,
    parentId: "root",
    partId,
    position: [0, 0, 0] as Vec3,
    rotation: [0, 0, 0] as Vec3,
    scale: [1, 1, 1] as Vec3,
    ...extra,
  };
}

/** A hull at the origin and a leg being dragged, as the scene would hold them. */
function drag(
  leg: Partial<LegoPiece>,
  customHull?: LegoPiece["customAnchors"],
) {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  const project: LegoProject = {
    ...base,
    pieces: [
      ...base.pieces,
      piece("hull", "hull", customHull ? { customAnchors: customHull } : {}),
      piece("leg", "leg", leg),
    ],
  };
  const groups = new Map<string, THREE.Group>();
  for (const p of project.pieces) {
    const group = new THREE.Group();
    group.userData.pieceId = p.id;
    group.position.set(...p.position);
    group.rotation.set(...p.rotation);
    group.scale.set(...p.scale);
    group.updateMatrixWorld(true);
    groups.set(p.id, group);
  }
  const dragged = groups.get("leg") as THREE.Group;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  const state = {
    gizmo: { object: dragged, getMode: () => "translate" },
    groups,
    camera,
    renderer: { getSize: (v: THREE.Vector2) => v.set(800, 600) },
    projectRef: { current: project },
    packRef: { current: pack },
    rawRef: { current: null },
    snapping: true,
    seat: null,
    targetAnchors: null,
    onSnapChange: () => {},
    seatMark: new THREE.Object3D(),
    seatOutline: { visible: false, setFromObject: () => {} },
  } as unknown as SceneState;
  return { state, dragged };
}

describe("applySnap", () => {
  it("saves a join when the faces point at each other", () => {
    const { state, dragged } = drag({ position: [0, 1.52, 0] });

    applySnap(state);

    expect(dragged.position.y).toBeCloseTo(1.5);
    expect(state.seat).toEqual({
      parentId: "hull",
      connector: "-y",
      to: "+y",
    });
  });

  it("moves the piece and saves nothing when the faces point the same way", () => {
    // The leg's top is against the hull's top, and both face up.
    const { state, dragged } = drag({ position: [0, -0.48, 0] });

    applySnap(state);

    expect(dragged.position.y).toBeCloseTo(-0.5);
    expect(state.seat).toBeNull();
  });

  it("clears the seat when the drag moves away again", () => {
    const { state, dragged } = drag({ position: [0, 1.52, 0] });
    applySnap(state);
    expect(state.seat).not.toBeNull();

    dragged.position.set(0, 6, 0);
    applySnap(state);

    expect(state.seat).toBeNull();
  });

  it("steps a free piece by the part unit when no anchor is in reach", () => {
    const { state, dragged } = drag({ position: [0, 6.3, 0] });

    applySnap(state);

    expect(state.seat).toBeNull();
    expect(dragged.position.y).toBeCloseTo(6.25);
  });

  it("saves nothing with snapping off", () => {
    const { state } = drag({ position: [0, 1.52, 0] });
    state.snapping = false;

    applySnap(state);

    expect(state.seat).toBeNull();
  });

  it("joins through a custom connector on the part it seats against", () => {
    const nose = {
      id: "nose",
      name: "nose",
      position: [0, 0, 2] as Vec3,
      facing: [0, 0, 1] as Vec3,
    };
    // The leg lies along z with its -y face turned to -z, against the nose.
    const { state } = drag(
      { position: [0, 0, 3.02], rotation: [Math.PI / 2, 0, 0] },
      [nose],
    );

    applySnap(state);

    expect(state.seat?.to).toBe("nose");
    expect(state.seat?.parentId).toBe("hull");
  });
});
