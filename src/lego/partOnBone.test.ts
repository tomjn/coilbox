import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { BIPED, projectFromPlan } from "./bodyPlans";
import { mirrorTwin } from "./mirror";
import { type LegoPiece, type LegoProject, pieceById } from "./model";
import type { LegoPartInfo } from "./pack";
import { attachToBone, boneDirection } from "./partOnBone";
import { worldMatrix } from "./reparent";

type Vec3 = [number, number, number];

function part(min: Vec3, max: Vec3): LegoPartInfo {
  return {
    id: "block",
    packId: "lego",
    shapeId: "block",
    name: "block",
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

/** 2 long, 0.5 across, so the longest axis is z in the part's own space. */
const BEAM = part([-0.25, -0.25, -1], [0.25, 0.25, 1]);

function walker(): LegoProject {
  let n = 0;
  return projectFromPlan(BIPED, {
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
    newId: () => `b${n++}`,
  });
}

function bone(doc: LegoProject, id: string): LegoPiece {
  return doc.pieces.find((p) => p.bone === id) as LegoPiece;
}

/** Where a point of the part, in its own space, stands in the unit. */
function world(doc: LegoProject, pieceId: string, at: Vec3): Vec3 {
  const piece = pieceById(doc, pieceId) as LegoPiece;
  const pivot = piece.pivot ?? [0, 0, 0];
  const v = new THREE.Vector3(
    at[0] - pivot[0],
    at[1] - pivot[1],
    at[2] - pivot[2],
  ).applyMatrix4(worldMatrix(doc, pieceId));
  return [v.x, v.y, v.z];
}

function near(a: Vec3, b: Vec3) {
  a.forEach((value, i) => {
    expect(value).toBeCloseTo(b[i], 5);
  });
}

describe("attachToBone", () => {
  it("lies along the bone with its near end on the joint", () => {
    const doc = walker();
    const thigh = bone(doc, "thigh.l1");
    const knee = bone(doc, "shin.l1");
    const next = attachToBone(doc, BEAM, thigh.id, "new") as LegoProject;

    const added = pieceById(next, "new") as LegoPiece;
    expect(added.parentId).toBe(thigh.id);
    expect(added.position).toEqual([0, 0, 0]);
    expect(added.scale).toEqual([1, 1, 1]);
    // Back face of the beam is on the hip, front face points at the knee.
    near(world(next, "new", [0, 0, -1]), world(next, thigh.id, [0, 0, 0]));
    const front = world(next, "new", [0, 0, 1]);
    const toKnee = world(next, knee.id, [0, 0, 0]);
    const hip = world(next, thigh.id, [0, 0, 0]);
    const along = new THREE.Vector3(...front).sub(new THREE.Vector3(...hip));
    const bonePath = new THREE.Vector3(...toKnee).sub(
      new THREE.Vector3(...hip),
    );
    expect(along.clone().normalize().dot(bonePath.normalize())).toBeCloseTo(1);
    // The part keeps its own length.
    expect(along.length()).toBeCloseTo(2);
  });

  it("turns a part whose long axis is y the same way", () => {
    const doc = walker();
    const thigh = bone(doc, "thigh.l1");
    const tall = part([-0.25, -1, -0.25], [0.25, 1, 0.25]);
    const next = attachToBone(doc, tall, thigh.id, "new") as LegoProject;
    near(world(next, "new", [0, -1, 0]), world(next, thigh.id, [0, 0, 0]));
    // Hanging bones point down, so the far end is below the hip.
    expect(world(next, "new", [0, 1, 0])[1]).toBeLessThan(
      world(next, thigh.id, [0, 0, 0])[1] - 1.99,
    );
  });

  it("reads the box, not the name order", () => {
    const doc = walker();
    const thigh = bone(doc, "thigh.l1");
    const wide = part([-1, -0.25, -0.25], [1, 0.25, 0.25]);
    const next = attachToBone(doc, wide, thigh.id, "new") as LegoProject;
    near(world(next, "new", [-1, 0, 0]), world(next, thigh.id, [0, 0, 0]));
  });

  it("leaves the part unturned on a bone with no child bone", () => {
    const doc = walker();
    const foot = bone(doc, "foot.l1");
    expect(boneDirection(doc, foot.id)).toBeNull();
    const next = attachToBone(doc, BEAM, foot.id, "new") as LegoProject;
    const added = pieceById(next, "new") as LegoPiece;
    expect(added.rotation).toEqual([0, 0, 0]);
    expect(added.pivot).toBeUndefined();
    expect(added.parentId).toBe(foot.id);
  });

  it("is not for a piece that is not a bone", () => {
    const doc = walker();
    const plain: LegoProject = {
      ...doc,
      pieces: doc.pieces.map((p) => {
        const { bone: _b, ...rest } = p;
        return rest;
      }),
    };
    expect(attachToBone(plain, BEAM, doc.rootPieceId, "new")).toBeNull();
  });

  it("gives the twin bone the mirrored part", () => {
    const doc = walker();
    const left = bone(doc, "thigh.l1");
    const right = bone(doc, "thigh.r1");
    const next = attachToBone(doc, BEAM, left.id, "new") as LegoProject;
    let n = 0;
    const twinned = mirrorTwin(next, "new", () => `t${n++}`);
    expect(twinned).not.toBeNull();
    const twin = pieceById(
      twinned?.project as LegoProject,
      twinned?.twinId ?? "",
    );
    expect(twin?.parentId).toBe(right.id);
    const out = twinned?.project as LegoProject;
    const id = twinned?.twinId as string;
    near(world(out, id, [0, 0, -1]), world(out, right.id, [0, 0, 0]));
  });
});
