import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { insertCompound, selectionAsCompound } from "./compounds";
import {
  boxConnectors,
  connectPiece,
  customConnectors,
  describeJoin,
  disconnectPiece,
  faceName,
  joinFaceOutlines,
  type LegoConnector,
  pieceConnectors,
  readPartConnectors,
  resolveConnections,
  setJoinPlace,
  slideJoin,
  withConnections,
} from "./connectors";
import { emptyDocument, reduceDocument } from "./document";
import { mirrorPiece } from "./mirror";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  parseLegoProjectData,
  projectProblems,
} from "./model";
import {
  type LegoPartInfo,
  type LoadedPack,
  projectPackProblems,
} from "./pack";
import { reparentPiece, worldMatrix } from "./reparent";
import { bakedPieces, buildS3o } from "./s3oBuild";

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

/** A hull 2 wide, 1 high and 4 long, a leg 0.5 by 2 by 0.5, and a long hull. */
function pack(): LoadedPack {
  const parts = [
    part("hull", [-1, -0.5, -2], [1, 0.5, 2]),
    part("leg", [-0.25, -1, -0.25], [0.25, 1, 0.25]),
    part("bighull", [-2, -1, -3], [2, 1, 3]),
    part("post", [-0.25, -1, -0.25], [0.5, 1, 0.25]),
  ];
  return {
    manifest: {} as LoadedPack["manifest"],
    library: {
      packs: [],
      atlases: [{ tex1: "atlas.png", packId: "lego", folder: null }],
      dir: "",
      problems: [],
    },
    parts,
    byId: new Map(parts.map((p) => [p.id, p])),
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  };
}

function project(pieces: Partial<LegoPiece>[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      ...pieces.map((piece, i) => ({
        id: `piece${i}`,
        name: piece.id ?? `piece${i}`,
        parentId: "root",
        partId: null,
        position: [0, 0, 0] as Vec3,
        rotation: [0, 0, 0] as Vec3,
        scale: [1, 1, 1] as Vec3,
        ...piece,
      })),
    ],
  };
}

function pieceOf(doc: LegoProject, id: string): LegoPiece {
  return doc.pieces.find((piece) => piece.id === id) as LegoPiece;
}

function round(values: number[]): number[] {
  return values.map((n) => Number(n.toFixed(6)) + 0);
}

/** Where a point in a part's own space lands in the unit. */
function worldPoint(doc: LegoProject, id: string, inPart: Vec3): number[] {
  const pivot = pieceOf(doc, id).pivot ?? [0, 0, 0];
  const point = new THREE.Vector3(
    inPart[0] - pivot[0],
    inPart[1] - pivot[1],
    inPart[2] - pivot[2],
  ).applyMatrix4(worldMatrix(doc, id));
  return round([point.x, point.y, point.z]);
}

/** Which way a part's outward face direction points in the unit. */
function worldNormal(doc: LegoProject, id: string, normal: Vec3): number[] {
  const matrix = new THREE.Matrix3().getNormalMatrix(worldMatrix(doc, id));
  const out = new THREE.Vector3(...normal).applyMatrix3(matrix).normalize();
  return round([out.x, out.y, out.z]);
}

/** Which way a direction along a part's face points in the unit. */
function worldDirection(doc: LegoProject, id: string, along: Vec3): number[] {
  const out = new THREE.Vector3(...along)
    .transformDirection(worldMatrix(doc, id))
    .normalize();
  return round([out.x, out.y, out.z]);
}

function negate(values: number[]): number[] {
  return round(values.map((n) => -n));
}

const hullAndLeg = (leg: Partial<LegoPiece>) =>
  project([
    { id: "hull", partId: "hull" },
    { id: "leg", parentId: "hull", partId: "leg", ...leg },
  ]);

describe("boxConnectors", () => {
  const connectors = boxConnectors({ min: [-1, -0.5, -2], max: [1, 0.5, 2] });

  it("puts one connector at the middle of each face, facing out", () => {
    expect(connectors.map((c) => [c.id, c.position, c.facing])).toEqual([
      ["+x", [1, 0, 0], [1, 0, 0]],
      ["-x", [-1, 0, 0], [-1, 0, 0]],
      ["+y", [0, 0.5, 0], [0, 1, 0]],
      ["-y", [0, -0.5, 0], [0, -1, 0]],
      ["+z", [0, 0, 2], [0, 0, 1]],
      ["-z", [0, 0, -2], [0, 0, -1]],
    ]);
  });

  it("gives every connector an up direction along its face", () => {
    for (const c of connectors) {
      const dot =
        c.facing[0] * c.up[0] + c.facing[1] * c.up[1] + c.facing[2] * c.up[2];
      expect(dot).toBe(0);
      expect(Math.hypot(...c.up)).toBe(1);
    }
    // Up is up on a side face, and forward on the top and the bottom.
    expect(connectors.find((c) => c.id === "+x")?.up).toEqual([0, 1, 0]);
    expect(connectors.find((c) => c.id === "+y")?.up).toEqual([0, 0, 1]);
  });

  it("gives an empty piece no connectors", () => {
    expect(pieceConnectors(pack(), pieceOf(project([{}]), "piece0"))).toEqual(
      [],
    );
  });
});

describe("resolveConnections", () => {
  it("hangs a leg's top face against the hull's bottom face", () => {
    const doc = hullAndLeg({ connection: { connector: "+y", to: "-y" } });
    const { project: out, broken } = resolveConnections(doc, pack());
    expect(broken).toEqual([]);
    const leg = pieceOf(out, "leg");
    expect(round(leg.position)).toEqual([0, -1.5, 0]);
    expect(round(leg.rotation)).toEqual([0, 0, 0]);
    expect(worldPoint(out, "leg", [0, 1, 0])).toEqual(
      worldPoint(out, "hull", [0, -0.5, 0]),
    );
  });

  it("turns the piece so the two faces point at each other", () => {
    const doc = hullAndLeg({ connection: { connector: "+y", to: "+x" } });
    const out = resolveConnections(doc, pack()).project;
    expect(worldPoint(out, "leg", [0, 1, 0])).toEqual(
      worldPoint(out, "hull", [1, 0, 0]),
    );
    expect(worldNormal(out, "leg", [0, 1, 0])).toEqual(
      negate(worldNormal(out, "hull", [1, 0, 0])),
    );
    // The leg's own up direction on that face (forward) lines up with the
    // hull's up direction on its side face (up).
    expect(worldDirection(out, "leg", [0, 0, 1])).toEqual([0, 1, 0]);
  });

  it("works under a parent that is itself moved and turned", () => {
    const doc = project([
      {
        id: "hull",
        partId: "hull",
        position: [3, 1, -2],
        rotation: [0.3, -1.1, 0.7],
      },
      {
        id: "leg",
        parentId: "hull",
        partId: "leg",
        connection: { connector: "-x", to: "+z" },
      },
    ]);
    const out = resolveConnections(doc, pack()).project;
    expect(worldPoint(out, "leg", [-0.25, 0, 0])).toEqual(
      worldPoint(out, "hull", [0, 0, 2]),
    );
    expect(worldNormal(out, "leg", [-1, 0, 0])).toEqual(
      negate(worldNormal(out, "hull", [0, 0, 1])),
    );
  });

  it("slides along the face by the offset, and twists about it", () => {
    const doc = hullAndLeg({
      connection: {
        connector: "+y",
        to: "-y",
        offset: [0.5, 1],
        twist: Math.PI / 2,
      },
    });
    const out = resolveConnections(doc, pack()).project;
    // On the bottom face, up is forward (+z) and the side is facing x up, which
    // is -y x +z = -x.
    expect(worldPoint(out, "leg", [0, 1, 0])).toEqual([-0.5, -0.5, 1]);
    // A quarter turn about -y takes the leg's forward from +z round to -x.
    expect(worldDirection(out, "leg", [0, 0, 1])).toEqual([-1, 0, 0]);
  });

  it("seats the connector, not the origin, on a piece with a pivot", () => {
    const doc = hullAndLeg({
      pivot: [0, 1, 0],
      connection: { connector: "+y", to: "-y" },
    });
    const out = resolveConnections(doc, pack()).project;
    expect(round(pieceOf(out, "leg").position)).toEqual([0, -0.5, 0]);
    expect(worldPoint(out, "leg", [0, 1, 0])).toEqual([0, -0.5, 0]);
  });

  it("moves the connector with the piece's own scale", () => {
    const doc = hullAndLeg({
      scale: [1, 2, 1],
      connection: { connector: "+y", to: "-y" },
    });
    const out = resolveConnections(doc, pack()).project;
    expect(round(pieceOf(out, "leg").position)).toEqual([0, -2.5, 0]);
    expect(worldPoint(out, "leg", [0, 1, 0])).toEqual([0, -0.5, 0]);
  });

  it("joins the face a mirrored piece has on that side now", () => {
    // Mirrored in x, the leg's "+x" face is the one on its left.
    const doc = hullAndLeg({
      scale: [-1, 1, 1],
      connection: { connector: "+x", to: "+x" },
    });
    const out = resolveConnections(doc, pack()).project;
    expect(worldPoint(out, "leg", [0.25, 0, 0])).toEqual([1, 0, 0]);
    expect(worldNormal(out, "leg", [1, 0, 0])).toEqual([-1, 0, 0]);
    expect(round(pieceOf(out, "leg").scale)).toEqual([-1, 1, 1]);
  });

  it("seats a part on the side face of a parent mirrored in x", () => {
    // The hull's "+x" face is at x = -1 once the hull is mirrored.
    for (const [connector, to, face, own, theirs] of [
      ["-x", "+x", -1, [-1, 0, 0], [1, 0, 0]],
      ["+x", "-x", 1, [1, 0, 0], [-1, 0, 0]],
    ] as const) {
      const doc = project([
        { id: "hull", partId: "hull", scale: [-1, 1, 1] },
        {
          id: "leg",
          parentId: "hull",
          partId: "post",
          connection: { connector, to },
        },
      ]);
      const out = resolveConnections(doc, pack()).project;
      const edge = connector === "-x" ? -0.25 : 0.5;
      expect(worldPoint(out, "leg", [edge, 0, 0])).toEqual([face, 0, 0]);
      expect(worldNormal(out, "leg", [...own])).toEqual(
        negate(worldNormal(out, "hull", [...theirs])),
      );
    }
  });

  it("keeps a side join on a face when its parent is mirrored", () => {
    const doc = resolveConnections(
      project([
        { id: "hull", partId: "hull" },
        {
          id: "leg",
          parentId: "hull",
          partId: "post",
          connection: { connector: "-x", to: "+x" },
        },
      ]),
      pack(),
    ).project;
    expect(worldPoint(doc, "leg", [-0.25, 0, 0])).toEqual([1, 0, 0]);
    const mirrored = resolveConnections(
      {
        ...doc,
        pieces: doc.pieces.map((p) =>
          p.id === "hull" ? { ...p, scale: [-1, 1, 1] as Vec3 } : p,
        ),
      },
      pack(),
    ).project;
    expect(worldPoint(mirrored, "leg", [-0.25, 0, 0])).toEqual([-1, 0, 0]);
  });

  it("follows the parent when its part changes", () => {
    const doc = resolveConnections(
      hullAndLeg({ connection: { connector: "+y", to: "-y" } }),
      pack(),
    ).project;
    const swapped = {
      ...doc,
      pieces: doc.pieces.map((piece) =>
        piece.id === "hull" ? { ...piece, partId: "bighull" } : piece,
      ),
    };
    const out = resolveConnections(swapped, pack()).project;
    expect(round(pieceOf(out, "leg").position)).toEqual([0, -2, 0]);
  });

  it("leaves a free piece exactly where it is", () => {
    const doc = hullAndLeg({ position: [5, 6, 7], rotation: [0.1, 0.2, 0.3] });
    const result = resolveConnections(doc, pack());
    expect(result.project).toBe(doc);
    expect(result.broken).toEqual([]);
  });

  it("answers the same document when nothing had to move", () => {
    const once = resolveConnections(
      hullAndLeg({ connection: { connector: "+y", to: "-y" } }),
      pack(),
    ).project;
    expect(resolveConnections(once, pack()).project).toBe(once);
  });

  it("keeps the last transform of a join that cannot be resolved, and says so", () => {
    const doc = project([
      { id: "hull", partId: "hull" },
      {
        id: "gone",
        parentId: "hull",
        partId: "leg",
        position: [1, 2, 3],
        connection: { connector: "+y", to: "bogus" },
      },
      { id: "empty" },
      {
        id: "onEmpty",
        parentId: "empty",
        partId: "leg",
        position: [4, 5, 6],
        connection: { connector: "+y", to: "-y" },
      },
    ]);
    const result = resolveConnections(doc, pack());
    expect(result.project).toBe(doc);
    expect(result.broken).toEqual(["gone", "onEmpty"]);
    const joins = projectPackProblems(doc, pack()).filter((p) =>
      p.includes("joined"),
    );
    expect(joins).toEqual([
      `"gone" is joined by a connector that its part or its parent's part does not have, so it stays where it was.`,
      `"onEmpty" is joined by a connector that its part or its parent's part does not have, so it stays where it was.`,
    ]);
  });
});

describe("connectPiece and disconnectPiece", () => {
  it("joins a piece and places it in one step", () => {
    const doc = hullAndLeg({ position: [9, 9, 9] });
    const out = connectPiece(doc, pack(), "leg", {
      connector: "+y",
      to: "-y",
    });
    expect(pieceOf(out, "leg").connection).toEqual({
      connector: "+y",
      to: "-y",
    });
    expect(round(pieceOf(out, "leg").position)).toEqual([0, -1.5, 0]);
  });

  it("leaves a detached piece where the join had put it", () => {
    const joined = connectPiece(hullAndLeg({}), pack(), "leg", {
      connector: "+y",
      to: "+x",
    });
    const out = disconnectPiece(joined, "leg");
    const leg = pieceOf(out, "leg");
    expect(leg.connection).toBeUndefined();
    expect(leg.position).toEqual(pieceOf(joined, "leg").position);
    expect(leg.rotation).toEqual(pieceOf(joined, "leg").rotation);
    expect(disconnectPiece(out, "leg")).toBe(out);
  });
});

describe("describeJoin", () => {
  it("names the parent and both faces of a join", () => {
    const joined = connectPiece(hullAndLeg({}), pack(), "leg", {
      connector: "+y",
      to: "-y",
    });
    expect(describeJoin(joined, pack(), pieceOf(joined, "leg"))).toEqual({
      parentName: pieceOf(joined, "hull").name,
      connector: "+y",
      to: "-y",
      connectorName: "top",
      toName: "bottom",
      offset: [0, 0],
      twist: 0,
      broken: false,
    });
  });

  it("names a box's six faces by the unit's own directions", () => {
    const names = ["+y", "-y", "+z", "-z", "+x", "-x"].map((to) => {
      const doc = connectPiece(hullAndLeg({}), pack(), "leg", {
        connector: "+y",
        to,
      });
      return describeJoin(doc, pack(), pieceOf(doc, "leg"))?.toName;
    });
    expect(names).toEqual(["top", "bottom", "front", "back", "left", "right"]);
  });

  it("shows a connector the pack states by its id", () => {
    const stated = pack();
    (stated.byId.get("hull") as LegoPartInfo).connectors = [
      { id: "+y", position: [0, 0.5, 0], facing: [0, 1, 0], up: [0, 0, 1] },
    ];
    const doc = connectPiece(hullAndLeg({}), stated, "leg", {
      connector: "+y",
      to: "+y",
    });
    const join = describeJoin(doc, stated, pieceOf(doc, "leg"));
    expect(join?.toName).toBe("+y");
    expect(join?.connectorName).toBe("top");
  });

  it("reports the offset and twist the join rests at", () => {
    const doc = hullAndLeg({
      connection: { connector: "+y", to: "-y", offset: [0.5, 0.25], twist: 1 },
    });
    const join = describeJoin(doc, pack(), pieceOf(doc, "leg"));
    expect(join?.offset).toEqual([0.5, 0.25]);
    expect(join?.twist).toBe(1);
  });

  it("says nothing about a free piece", () => {
    const doc = hullAndLeg({});
    expect(describeJoin(doc, pack(), pieceOf(doc, "leg"))).toBeNull();
  });

  it("marks a join to a face the parent's part does not have as broken", () => {
    const joined = connectPiece(hullAndLeg({}), pack(), "leg", {
      connector: "+y",
      to: "-y",
    });
    const bad = {
      ...joined,
      pieces: joined.pieces.map((p) =>
        p.id === "leg"
          ? { ...p, connection: { connector: "+y", to: "nope" } }
          : p,
      ),
    };
    expect(describeJoin(bad, pack(), pieceOf(bad, "leg"))?.broken).toBe(true);
  });
});

describe("joinFaceOutlines", () => {
  const joined = () =>
    connectPiece(hullAndLeg({}), pack(), "leg", { connector: "+y", to: "-y" });

  it("outlines the joined face on the piece and on its parent", () => {
    const out = joinFaceOutlines(joined(), pack(), "leg", false);
    expect(out.map((o) => [o.owner, o.kind])).toEqual([
      ["leg", "joined"],
      ["hull", "joined"],
    ]);
  });

  it("draws each outline as four corners lying on the face", () => {
    const [own] = joinFaceOutlines(joined(), pack(), "leg", false);
    expect(own.corners).toHaveLength(4);
    // The leg's top face is at y = 1 in its part space, pivot 0.
    for (const corner of own.corners) expect(corner[1]).toBeCloseTo(1);
    // Smaller than the 0.5 by 0.5 face, so the edge stays visible.
    const xs = own.corners.map((c) => c[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.5);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0);
  });

  it("adds the piece's other faces as free when asked", () => {
    const out = joinFaceOutlines(joined(), pack(), "leg", true);
    const free = out.filter((o) => o.kind === "free");
    expect(free).toHaveLength(5);
    expect(free.every((o) => o.owner === "leg")).toBe(true);
  });

  it("shows every face of a free piece as free, and none unless asked", () => {
    const doc = hullAndLeg({});
    expect(joinFaceOutlines(doc, pack(), "leg", false)).toEqual([]);
    expect(joinFaceOutlines(doc, pack(), "leg", true)).toHaveLength(6);
  });

  it("draws nothing for a join that cannot be made", () => {
    const bad = hullAndLeg({ connection: { connector: "+y", to: "nope" } });
    const out = joinFaceOutlines(bad, pack(), "leg", false);
    expect(out.map((o) => o.owner)).toEqual(["leg"]);
  });
});

describe("setJoinPlace", () => {
  const joined = () =>
    connectPiece(hullAndLeg({}), pack(), "leg", { connector: "+y", to: "-y" });

  it("moves the piece along the face when the offset is set", () => {
    const out = setJoinPlace(joined(), pack(), "leg", { offset: [0.5, 0] });
    expect(pieceOf(out, "leg").connection?.offset).toEqual([0.5, 0]);
    expect(round(pieceOf(out, "leg").position)).not.toEqual(
      round(pieceOf(joined(), "leg").position),
    );
  });

  it("turns the piece on the face when the twist is set", () => {
    const out = setJoinPlace(joined(), pack(), "leg", { twist: Math.PI / 2 });
    expect(pieceOf(out, "leg").connection?.twist).toBe(Math.PI / 2);
    expect(round(pieceOf(out, "leg").rotation)).not.toEqual(
      round(pieceOf(joined(), "leg").rotation),
    );
  });

  it("stores no offset or twist for the rest position", () => {
    const moved = setJoinPlace(joined(), pack(), "leg", {
      offset: [0.5, 0],
      twist: 1,
    });
    const back = setJoinPlace(moved, pack(), "leg", {
      offset: [0, 0],
      twist: 0,
    });
    expect(pieceOf(back, "leg").connection).toEqual({
      connector: "+y",
      to: "-y",
    });
    expect(round(pieceOf(back, "leg").position)).toEqual(
      round(pieceOf(joined(), "leg").position),
    );
  });

  it("leaves a free piece alone", () => {
    const doc = hullAndLeg({});
    expect(setJoinPlace(doc, pack(), "leg", { offset: [1, 0] })).toBe(doc);
  });
});

describe("withConnections", () => {
  it("resolves after the change, so moving the parent's part moves the child", () => {
    const doc = connectPiece(hullAndLeg({}), pack(), "leg", {
      connector: "+y",
      to: "-y",
    });
    const change = withConnections(
      (p: LegoProject) => ({
        ...p,
        pieces: p.pieces.map((piece) =>
          piece.id === "hull" ? { ...piece, partId: "bighull" } : piece,
        ),
      }),
      pack(),
    );
    expect(round(pieceOf(change(doc), "leg").position)).toEqual([0, -2, 0]);
  });

  it("moves the child in the same undo step as the parent's change", () => {
    const doc = connectPiece(hullAndLeg({}), pack(), "leg", {
      connector: "+y",
      to: "-y",
    });
    const opened = reduceDocument(emptyDocument, {
      type: "open",
      project: doc,
    });
    const edited = reduceDocument(opened, {
      type: "edit",
      change: withConnections(
        (p: LegoProject) => ({
          ...p,
          pieces: p.pieces.map((piece) =>
            piece.id === "hull" ? { ...piece, partId: "bighull" } : piece,
          ),
        }),
        pack(),
      ),
      at: 1000,
    });
    const undone = reduceDocument(edited, { type: "undo" });
    const leg = pieceOf(undone.project as LegoProject, "leg");
    expect(round(leg.position)).toEqual([0, -1.5, 0]);
    expect(leg.connection).toEqual({ connector: "+y", to: "-y" });
    const redone = reduceDocument(undone, { type: "redo" });
    expect(
      round(pieceOf(redone.project as LegoProject, "leg").position),
    ).toEqual([0, -2, 0]);
  });

  it("passes an edit through untouched with no pack loaded", () => {
    const doc = hullAndLeg({ connection: { connector: "+y", to: "-y" } });
    const identity = (p: LegoProject) => p;
    expect(withConnections(identity, null)(doc)).toBe(doc);
    const moved = withConnections(
      (p: LegoProject) => ({ ...p, name: "renamed" }),
      null,
    )(doc);
    expect(pieceOf(moved, "leg").position).toEqual([0, 0, 0]);
  });
});

describe("saved connections", () => {
  it("survive a save and a load", () => {
    const doc = hullAndLeg({
      connection: { connector: "+y", to: "-y", offset: [0.5, 0], twist: 1 },
    });
    const loaded = parseLegoProjectData(JSON.parse(JSON.stringify(doc)));
    expect(pieceOf(loaded as LegoProject, "leg").connection).toEqual({
      connector: "+y",
      to: "-y",
      offset: [0.5, 0],
      twist: 1,
    });
  });

  it("load a piece saved before connections as a free piece", () => {
    const doc = hullAndLeg({ position: [1, 2, 3] });
    const loaded = parseLegoProjectData(JSON.parse(JSON.stringify(doc)));
    const leg = pieceOf(loaded as LegoProject, "leg");
    expect("connection" in leg).toBe(false);
    expect(leg.position).toEqual([1, 2, 3]);
  });

  it("drop a join that does not name both connectors, and a bad offset or twist", () => {
    const raw = JSON.parse(JSON.stringify(hullAndLeg({})));
    raw.pieces[2].connection = { connector: "+y" };
    expect(
      "connection" in pieceOf(parseLegoProjectData(raw) as LegoProject, "leg"),
    ).toBe(false);
    raw.pieces[2].connection = {
      connector: "+y",
      to: "-y",
      offset: [1],
      twist: "a lot",
    };
    expect(
      pieceOf(parseLegoProjectData(raw) as LegoProject, "leg").connection,
    ).toEqual({ connector: "+y", to: "-y" });
  });

  it("are reported on a piece with no parent", () => {
    const doc = project([]);
    const joined = {
      ...doc,
      pieces: doc.pieces.map((piece) => ({
        ...piece,
        connection: { connector: "+y", to: "-y" },
      })),
    };
    expect(projectProblems(joined)).toContain(
      `"base" is saved as joined to a parent, but it has none.`,
    );
  });
});

describe("the export", () => {
  it("bakes a joined piece where its join puts it, even if the stored transform is stale", () => {
    const doc = hullAndLeg({
      position: [7, 7, 7],
      connection: { connector: "+y", to: "-y" },
    });
    const baked = bakedPieces(doc, pack(), null).pieces;
    expect(round(baked.get("leg")?.offset as number[])).toEqual([0, -1.5, 0]);
  });

  it("poses the wreck from where the joins put each piece (#3310)", () => {
    const doc = hullAndLeg({
      position: [7, 7, 7],
      connection: { connector: "+y", to: "-y" },
    });
    const wreck = buildS3o(
      doc,
      pack(),
      null,
      { texture1: "a.png" },
      {
        pose: new Map([["hull", { position: [0, -1, 0] as Vec3 }]]),
      },
    );
    const hull = wreck?.root.children.find((piece) => piece.name === "hull");
    expect(round(hull?.offset as number[])).toEqual([0, -1, 0]);
    expect(round(hull?.children[0].offset as number[])).toEqual([0, -1.5, 0]);
  });
});

describe("operations that give a piece a new place", () => {
  const joined = () =>
    connectPiece(
      project([
        { id: "hull", partId: "hull" },
        { id: "arm", partId: "hull" },
        { id: "leg", parentId: "hull", partId: "leg" },
        { id: "foot", parentId: "leg", partId: "leg" },
      ]),
      pack(),
      "leg",
      { connector: "+y", to: "+x" },
    );
  const withFoot = () =>
    connectPiece(joined(), pack(), "foot", { connector: "+y", to: "-y" });

  it("reparenting frees the piece where it stands", () => {
    const out = reparentPiece(joined(), "leg", "arm");
    expect(pieceOf(out, "leg").connection).toBeUndefined();
  });

  it("mirroring frees the mirrored piece, and keeps the joins under it", () => {
    const out = mirrorPiece(withFoot(), "leg");
    expect(pieceOf(out, "leg").connection).toBeUndefined();
    expect(pieceOf(out, "foot").connection).toEqual({
      connector: "+y",
      to: "-y",
    });
  });

  it("a compound keeps the joins inside it and frees the piece it hangs from", () => {
    let n = 0;
    const newId = () => `new${n++}`;
    const compound = selectionAsCompound(withFoot(), ["leg"], {
      id: "c",
      now: "",
      newId,
    }) as LegoProject;
    const root = pieceOf(compound, compound.rootPieceId);
    expect(root.connection).toBeUndefined();
    const inner = compound.pieces.find((piece) => piece.id !== root.id);
    expect(inner?.connection).toEqual({ connector: "+y", to: "-y" });

    // A compound saved with a join on its root still lands free.
    const stored = {
      ...compound,
      pieces: compound.pieces.map((piece) =>
        piece.id === root.id
          ? { ...piece, connection: { connector: "+y", to: "-y" } }
          : piece,
      ),
    };
    const inserted = insertCompound(withFoot(), stored, "arm", newId);
    const [landed] = inserted.rootPieceIds;
    expect(pieceOf(inserted.project, landed).connection).toBeUndefined();
    const child = inserted.project.pieces.find((p) => p.parentId === landed);
    expect(child?.connection).toEqual({ connector: "+y", to: "-y" });
  });
});

describe("connectors a part states itself", () => {
  /** One socket on the top of the hull, set back from the middle. */
  const socket: LegoConnector = {
    id: "socket",
    position: [0.5, 0.5, -1],
    facing: [0, 1, 0],
    up: [0, 0, 1],
  };

  function statedPack(connectors: LegoConnector[]): LoadedPack {
    const base = pack();
    const hull = { ...(base.byId.get("hull") as LegoPartInfo), connectors };
    const parts = base.parts.map((p) => (p.id === "hull" ? hull : p));
    return {
      ...base,
      parts,
      byId: new Map(parts.map((p) => [p.id, p])),
    };
  }

  it("uses the stated list and none of the derived ones", () => {
    const stated = statedPack([socket]);
    const hull = pieceOf(project([{ id: "hull", partId: "hull" }]), "hull");
    expect(pieceConnectors(stated, hull).map((c) => c.id)).toEqual(["socket"]);
  });

  it("derives connectors for a part that states none", () => {
    const stated = statedPack([socket]);
    const leg = pieceOf(project([{ id: "leg", partId: "leg" }]), "leg");
    expect(pieceConnectors(stated, leg)).toHaveLength(6);
  });

  it("treats a stated empty list as a part nothing can join", () => {
    const stated = statedPack([]);
    const hull = pieceOf(project([{ id: "hull", partId: "hull" }]), "hull");
    expect(pieceConnectors(stated, hull)).toEqual([]);
  });

  it("joins a piece at a stated connector", () => {
    const stated = statedPack([socket]);
    const joined = connectPiece(hullAndLeg({}), stated, "leg", {
      connector: "-y",
      to: "socket",
    });
    // The leg's bottom centre sits on the socket.
    expect(worldPoint(joined, "leg", [0, -1, 0])).toEqual([0.5, 0.5, -1]);
  });

  it("breaks a join to a derived connector the part no longer has", () => {
    const stated = statedPack([socket]);
    const joined = connectPiece(hullAndLeg({}), stated, "leg", {
      connector: "-y",
      to: "+y",
    });
    expect(resolveConnections(joined, stated).broken).toEqual(["leg"]);
  });
});

describe("readPartConnectors", () => {
  const good = {
    id: "top",
    position: [0, 0.5, 0],
    facing: [0, 1, 0],
    up: [0, 0, 1],
  };

  it("accepts a well formed list", () => {
    expect(readPartConnectors([good])).toEqual({ connectors: [good] });
  });

  it("accepts an empty list", () => {
    expect(readPartConnectors([])).toEqual({ connectors: [] });
  });

  it("accepts a facing that is unit length to within rounding", () => {
    const rounded = { ...good, facing: [0, 0.99999, 0] };
    expect(readPartConnectors([rounded])).toHaveProperty("connectors");
  });

  const bad: [string, unknown, RegExp][] = [
    ["a list that is not a list", { good }, /list/],
    ["an entry that is not an object", [null], /connector 1/],
    ["an empty id", [{ ...good, id: "" }], /id/],
    ["an id that is not a string", [{ ...good, id: 3 }], /id/],
    ["a repeated id", [good, { ...good }], /"top" twice/],
    [
      "a position of the wrong length",
      [{ ...good, position: [0, 1] }],
      /position/,
    ],
    [
      "a position that is not finite",
      [{ ...good, position: [0, Number.NaN, 0] }],
      /position/,
    ],
    [
      "a facing that is not unit length",
      [{ ...good, facing: [0, 2, 0] }],
      /facing/,
    ],
    ["an up that is not unit length", [{ ...good, up: [0, 0, 0] }], /up/],
    [
      "an up that is not at right angles to the facing",
      [{ ...good, up: [0, 1, 0] }],
      /right angles/,
    ],
  ];
  for (const [name, input, message] of bad) {
    it(`rejects ${name}`, () => {
      const result = readPartConnectors(input);
      expect(result).toHaveProperty("problem");
      expect((result as { problem: string }).problem).toMatch(message);
    });
  }

  it("names the connector that is wrong", () => {
    const result = readPartConnectors([
      good,
      { ...good, id: "b", facing: [0, 2, 0] },
    ]);
    expect((result as { problem: string }).problem).toMatch(/"b"/);
  });
});

describe("customConnectors", () => {
  const box = { min: [-1, -0.5, -2] as Vec3, max: [1, 0.5, 2] as Vec3 };

  it("keeps a stated facing and up", () => {
    const [c] = customConnectors(
      [
        {
          id: "a",
          name: "mouth",
          position: [0, 0, 2],
          facing: [0, 0, 1],
          up: [1, 0, 0],
        },
      ],
      box,
    );

    expect(c).toEqual({
      id: "a",
      position: [0, 0, 2],
      facing: [0, 0, 1],
      up: [1, 0, 0],
    });
  });

  it("points an anchor saved before facings out of the nearest face", () => {
    const connectors = customConnectors(
      [
        { id: "front", name: "front", position: [0, 0, 1.9] },
        { id: "top", name: "top", position: [0.2, 0.4, 0] },
        { id: "left", name: "left", position: [-0.9, 0, 0.5] },
      ],
      box,
    );

    expect(connectors.map((c) => c.facing)).toEqual([
      [0, 0, 1],
      [0, 1, 0],
      [-1, 0, 0],
    ]);
  });

  it("gives the default up of the box connectors when none is stated", () => {
    const [side, top] = customConnectors(
      [
        { id: "s", name: "s", position: [1, 0, 0] },
        { id: "t", name: "t", position: [0, 0.5, 0] },
      ],
      box,
    );

    expect(side.up).toEqual([0, 1, 0]);
    expect(top.up).toEqual([0, 0, 1]);
  });

  it("squares a stated up to the facing", () => {
    const [c] = customConnectors(
      [
        {
          id: "a",
          name: "a",
          position: [0, 0, 2],
          facing: [0, 0, 1],
          up: [1, 0, 1],
        },
      ],
      box,
    );

    expect(c.up.map((n) => Number(n.toFixed(6)) + 0)).toEqual([1, 0, 0]);
  });

  it("leaves out an anchor with neither a facing nor a box", () => {
    expect(
      customConnectors(
        [{ id: "a", name: "a", position: [0, 0, 1] }],
        undefined,
      ),
    ).toEqual([]);
  });
});

describe("pieceConnectors with custom anchors", () => {
  it("uses the piece's anchors in place of the part's", () => {
    const piece = {
      ...pieceOf(hullAndLeg({}), "hull"),
      customAnchors: [{ id: "a", name: "a", position: [0, 0, 2] as Vec3 }],
    };

    expect(pieceConnectors(pack(), piece).map((c) => c.id)).toEqual(["a"]);
  });

  it("joins a part through a custom anchor, facing out of its nearest face", () => {
    const doc = hullAndLeg({});
    const hull = {
      ...pieceOf(doc, "hull"),
      customAnchors: [
        { id: "nose", name: "nose", position: [0, 0, 2] as Vec3 },
      ],
    };
    const withNose = {
      ...doc,
      pieces: doc.pieces.map((p) => (p.id === "hull" ? hull : p)),
    };
    const joined = connectPiece(withNose, pack(), "leg", {
      connector: "-y",
      to: "nose",
    });

    // The leg's bottom faces down and the nose faces +z, so the leg turns to
    // point its bottom back along -z and lands on the nose.
    expect(worldPoint(joined, "leg", [0, -1, 0])).toEqual([0, 0, 2]);
    expect(worldNormal(joined, "leg", [0, -1, 0])).toEqual([0, 0, -1]);
  });
});

describe("slideJoin", () => {
  // A leg standing on the hull's top face. The face's side direction is +x and
  // its up direction is +z, so the offset is [along x, along z].
  const standing = (offset?: [number, number]) =>
    hullAndLeg({
      connection: { connector: "-y", to: "+y", ...(offset ? { offset } : {}) },
      position: [0, 1.5, 0],
    });

  it("steps the offset along the face from where it rests", () => {
    const slid = slideJoin(standing(), pack(), "leg", [0.7, 1.5, 0.3], 0.5);

    expect(slid?.offset).toEqual([0.5, 0.5]);
    expect(round(slid?.position ?? [])).toEqual([0.5, 1.5, 0.5]);
  });

  it("steps from the connection's resting place, not from the face's middle", () => {
    // Resting 0.2 along x, which is not on the step. A drag of 0.3 is one step
    // of 0.25 from there, not a snap to a multiple of 0.25 from the middle.
    const slid = slideJoin(
      standing([0.2, 0]),
      pack(),
      "leg",
      [0.5, 1.5, 0],
      0.25,
    );

    expect(slid?.offset[0]).toBeCloseTo(0.45);
  });

  it("drops the part of a drag that goes through the face", () => {
    const slid = slideJoin(standing(), pack(), "leg", [0, 4, 0], 0.5);

    expect(slid?.offset).toEqual([0, 0]);
    expect(round(slid?.position ?? [])).toEqual([0, 1.5, 0]);
  });

  it("does not stop a part sliding off the edge of the face", () => {
    const slid = slideJoin(standing(), pack(), "leg", [3, 1.5, 0], 0.5);

    expect(slid?.offset).toEqual([3, 0]);
  });

  it("moves freely along the face when there is no step", () => {
    const slid = slideJoin(standing(), pack(), "leg", [0.123, 1.5, 0], 0);

    expect(slid?.offset[0]).toBeCloseTo(0.123);
  });

  it("slides along a face the parent has turned", () => {
    const doc = project([
      { id: "hull", partId: "hull", rotation: [0, Math.PI / 2, 0] },
      {
        id: "leg",
        parentId: "hull",
        partId: "leg",
        connection: { connector: "-y", to: "+y" },
        position: [0, 1.5, 0],
      },
    ]);
    // The position is in the parent's frame, so the parent's turn changes nothing.
    const slid = slideJoin(doc, pack(), "leg", [1, 1.5, 0], 0.5);

    expect(slid?.offset).toEqual([1, 0]);
  });

  it("answers null for a piece with no join", () => {
    const doc = hullAndLeg({ position: [0, 1.5, 0] });

    expect(slideJoin(doc, pack(), "leg", [1, 1.5, 0], 0.5)).toBeNull();
  });
});

describe("pieceConnectors for a mesh piece (#3269)", () => {
  const mesh = {
    id: "m",
    name: "m",
    parentId: "root",
    partId: null,
    meshId: "mod/m0",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  } as LegoPiece;

  it("are the faces of the mesh's box, where the geometry is", () => {
    const connectors = pieceConnectors(pack(), {
      ...mesh,
      meshBox: { min: [-1, 2, -1], max: [3, 6, 1] },
    });
    expect(connectors.map((c) => c.id)).toEqual([
      "+x",
      "-x",
      "+y",
      "-y",
      "+z",
      "-z",
    ]);
    expect(connectors.find((c) => c.id === "+x")?.position).toEqual([3, 4, 0]);
    expect(connectors.find((c) => c.id === "-y")?.position).toEqual([1, 2, 0]);
  });

  it("are none while the box is unknown", () => {
    expect(pieceConnectors(pack(), mesh)).toEqual([]);
  });

  it("give way to the piece's own anchors", () => {
    const connectors = pieceConnectors(pack(), {
      ...mesh,
      meshBox: { min: [-1, 2, -1], max: [3, 6, 1] },
      customAnchors: [
        { id: "a", name: "a", position: [0, 6, 0], facing: [0, 1, 0] },
      ],
    });
    expect(connectors.map((c) => c.id)).toEqual(["a"]);
  });

  it("name the faces of a box, as a pack part's are", () => {
    const withBox = { ...mesh, meshBox: { min: [-1, 0, -1], max: [1, 2, 1] } };
    expect(faceName(pack(), withBox as LegoPiece, "+y")).toBe("top");
  });

  it("join a mesh piece to a hull so its bottom rests on the hull's top", () => {
    const project = {
      ...newProject({
        id: "p",
        rootPieceId: "root",
        name: "u",
        packId: "lego",
        packVersion: "1",
        now: "2026-10-17T00:00:00Z",
      }),
    };
    const hull = {
      ...mesh,
      id: "hull",
      meshId: undefined,
      partId: "hull",
    } as LegoPiece;
    const turret = {
      ...mesh,
      id: "turret",
      parentId: "hull",
      meshBox: { min: [-1, 2, -1], max: [1, 6, 1] },
      connection: { connector: "-y", to: "+y" },
    } as LegoPiece;
    const joined = resolveConnections(
      { ...project, pieces: [...project.pieces, hull, turret] },
      pack(),
    ).project;
    const placed = joined.pieces.find((p) => p.id === "turret") as LegoPiece;
    // Its origin sits 2 below its bottom face, which is on the hull's top (0.5).
    expect(placed.position[1]).toBeCloseTo(0.5 - 2);
  });
});
