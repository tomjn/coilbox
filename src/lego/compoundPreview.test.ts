import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { buildCompoundHolder } from "./compoundPreview";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { seatPieceMesh } from "./pivot";

/** A two by two by two block, standing in for whatever part is asked for. */
function brick(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(2, 2, 2);
}

/** A compound, named pieces hanging off the first unless told otherwise. */
function compound(
  pieces: (Partial<LegoPiece> & { name: string })[],
): LegoProject {
  const root = pieces[0].name;
  const base = newProject({
    id: "c",
    rootPieceId: root,
    name: "probe",
    packId: "lego",
    packVersion: "1",
    now: "2026-07-30T00:00:00Z",
  });
  return {
    ...base,
    rootPieceId: root,
    pieces: pieces.map((piece, i) => ({
      id: piece.name,
      parentId: i === 0 ? null : root,
      partId: "brick",
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      ...piece,
    })),
  };
}

function holderFor(project: LegoProject): THREE.Group {
  return buildCompoundHolder(
    project,
    brick,
    new THREE.MeshBasicMaterial(),
    100,
  );
}

function meshFor(holder: THREE.Group, pieceId: string): THREE.Mesh {
  let mesh: THREE.Mesh | undefined;
  holder.traverse((child) => {
    if (child.userData.pieceId !== pieceId) return;
    mesh = child.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh;
  });
  if (!mesh) throw new Error(`no mesh drawn for ${pieceId}`);
  return mesh;
}

/** Where a mesh sits in the compound's own frame, before the cell's fit. */
function inAssembly(holder: THREE.Group, pieceId: string): THREE.Vector3 {
  holder.updateMatrixWorld(true);
  const assembly = holder.children[0].children[0];
  return meshFor(holder, pieceId)
    .getWorldPosition(new THREE.Vector3())
    .applyMatrix4(assembly.matrixWorld.clone().invert());
}

describe("buildCompoundHolder", () => {
  it("seats a piece's mesh by its pivot, the way the viewport does", () => {
    // The compound this was reported on: a part pivoted at its bottom,
    // carrying one pivoted on a face.
    const holder = holderFor(
      compound([
        { name: "block9", pivot: [0, 1, 0] },
        { name: "block6", position: [0, -2, 0], pivot: [0, 0, -0.75] },
      ]),
    );

    // The mesh sits back from its piece's origin by the pivot, so a piece two
    // below its parent draws two below it and not somewhere else.
    expect(inAssembly(holder, "block9").toArray()).toEqual([0, -1, 0]);
    expect(inAssembly(holder, "block6").toArray()).toEqual([0, -2, 0.75]);
  });

  it("puts every mesh where the shared seating says, pivot or none", () => {
    const project = compound([
      { name: "block9", pivot: [0, 1, 0] },
      { name: "plain" },
    ]);
    const holder = holderFor(project);

    // The viewport seats its meshes with this same function, so a preview that
    // agrees with it here cannot draw a piece anywhere else.
    for (const piece of project.pieces) {
      const expected = new THREE.Object3D();
      seatPieceMesh(expected, piece.pivot);
      expect(meshFor(holder, piece.id).position.toArray()).toEqual(
        expected.position.toArray(),
      );
    }
  });

  it("draws every root of a compound saved from a set", () => {
    const holder = holderFor(
      compound([
        { name: "left" },
        { name: "right", parentId: null, position: [4, 0, 0] },
      ]),
    );

    expect(inAssembly(holder, "left").toArray()).toEqual([0, 0, 0]);
    expect(inAssembly(holder, "right").toArray()).toEqual([4, 0, 0]);
  });
});
