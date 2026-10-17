import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { newProject } from "../../model";
import type { LegoPartInfo, LoadedPack } from "../../pack";
import { clearJoinFaces, showJoinFaces } from "./joinFaceMarks";
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
  parts,
  byId: new Map(parts.map((p) => [p.id, p])),
} as unknown as LoadedPack;

function scene() {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  const piece = (id: string, partId: string, extra = {}) => ({
    id,
    name: id,
    parentId: "root",
    partId,
    position: [0, 0, 0] as Vec3,
    rotation: [0, 0, 0] as Vec3,
    scale: [1, 1, 1] as Vec3,
    ...extra,
  });
  const project = {
    ...base,
    pieces: [
      ...base.pieces,
      piece("hull", "hull"),
      piece("leg", "leg", {
        parentId: "hull",
        connection: { connector: "+y", to: "-y" },
      }),
    ],
  };
  const groups = new Map(project.pieces.map((p) => [p.id, new THREE.Group()]));
  const state = { groups, joinMarks: [] } as unknown as SceneState;
  return { state, project, groups };
}

describe("showJoinFaces", () => {
  it("draws an outline in the group of each piece the join touches", () => {
    const { state, project, groups } = scene();
    showJoinFaces(state, pack, project, "leg", false);
    expect(groups.get("leg")?.children).toHaveLength(1);
    expect(groups.get("hull")?.children).toHaveLength(1);
    expect(state.joinMarks).toHaveLength(2);
  });

  it("replaces what it drew before, and clears it for no selection", () => {
    const { state, project, groups } = scene();
    showJoinFaces(state, pack, project, "leg", true);
    showJoinFaces(state, pack, project, "leg", false);
    expect(state.joinMarks).toHaveLength(2);
    showJoinFaces(state, pack, project, null, false);
    expect(state.joinMarks).toHaveLength(0);
    expect(groups.get("leg")?.children).toHaveLength(0);
    clearJoinFaces(state);
  });

  it("cannot be hit by a click", () => {
    const { state, project } = scene();
    showJoinFaces(state, pack, project, "leg", false);
    const hits: THREE.Intersection[] = [];
    state.joinMarks[0].raycast(new THREE.Raycaster(), hits);
    expect(hits).toEqual([]);
  });
});
