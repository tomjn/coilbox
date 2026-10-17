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
  const changes: unknown[][] = [];
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
    slide: null,
    targetAnchors: null,
    onSnapChange: (...args: unknown[]) => changes.push(args),
    seatMark: new THREE.Object3D(),
    seatOutline: { visible: false, setFromObject: () => {} },
  } as unknown as SceneState;
  return { state, dragged, changes };
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

describe("applySnap on a joined piece", () => {
  const joined = (position: Vec3) =>
    drag({
      parentId: "hull",
      position,
      connection: { connector: "-y", to: "+y" },
    });

  it("slides along the face in steps of the part unit", () => {
    const { state, dragged, changes } = joined([0.6, 3, 0.3]);

    applySnap(state);

    // The face is the hull's top, so the drag up off it is dropped.
    expect(dragged.position.toArray().map((n) => Number(n.toFixed(6)))).toEqual(
      [0.5, 1.5, 0.25],
    );
    expect(state.slide).toEqual([0.5, 0.25]);
    expect(state.seat).toBeNull();
    expect(changes.at(-1)).toEqual([false, undefined, 0.25, [0.5, 0.25]]);
  });

  it("does not seat against a neighbour's anchor", () => {
    // Within reach of the hull's own top anchor, which would seat a free piece.
    const { state } = joined([0.01, 1.52, 0.01]);

    applySnap(state);

    expect(state.seat).toBeNull();
    expect(state.slide).toEqual([0, 0]);
  });

  it("places freely with no step and no slide while Alt is held", () => {
    const { state, dragged } = joined([0.6, 3, 0.3]);
    state.snapping = false;

    applySnap(state);

    expect(dragged.position.toArray()).toEqual([0.6, 3, 0.3]);
    expect(state.slide).toBeNull();
  });

  it("leaves a free piece to the move step", () => {
    const { state } = drag({ position: [0.6, 3, 0.3] });

    applySnap(state);

    expect(state.slide).toBeNull();
  });

  it("clears the slide when the drag turns to Alt", () => {
    const { state } = joined([0.6, 3, 0.3]);
    applySnap(state);
    state.snapping = false;

    applySnap(state);

    expect(state.slide).toBeNull();
  });
});
