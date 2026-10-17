import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { insertCompound, selectionAsCompound } from "./compounds";
import {
  boxConnectors,
  connectPiece,
  disconnectPiece,
  pieceConnectors,
  resolveConnections,
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
