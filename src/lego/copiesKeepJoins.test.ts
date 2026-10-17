/**
 * Mirror, symmetry, duplicate, copy and paste, and compounds keep parts joined
 * (issue #3309), and every writer of a joined piece's place leaves its join
 * agreeing with where it is drawn.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { parseClipboardPiece, serializeClipboardPiece } from "./clipboard";
import {
  duplicatePiece,
  insertCompound,
  selectionAsCompound,
} from "./compounds";
import { connectPiece, resolveConnections } from "./connectors";
import { followMirror, mirrorCopy, mirrorPiece, mirrorTwin } from "./mirror";
import {
  type LegoConnection,
  type LegoPiece,
  type LegoProject,
  newProject,
} from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { placePart } from "./placePart";
import { reparentPiece, worldMatrix } from "./reparent";
import { dragPiece, freeMoved, typedTransform } from "./seat";

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

/** A hull 2 wide, 1 high and 4 long, and a leg that is not the same both ways
 *  round, so a reflection that only moved it would show. */
function pack(): LoadedPack {
  const parts = [
    part("hull", [-1, -0.5, -2], [1, 0.5, 2]),
    part("leg", [-0.25, -1, -0.5], [0.5, 1, 0.25]),
  ];
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
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
      ...pieces.map((piece) => ({
        id: "x",
        name: piece.id ?? "x",
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

function round(m: THREE.Matrix4): number[] {
  return m.toArray().map((n) => Number(n.toFixed(5)) + 0);
}

const REFLECT = new THREE.Matrix4().makeScale(-1, 1, 1);

/** The reflection across the centre line of where `id` is drawn. */
function reflected(doc: LegoProject, id: string): number[] {
  return round(REFLECT.clone().multiply(worldMatrix(doc, id)));
}

/**
 * Whether resolving the joins leaves `id` where it is drawn now. A piece whose
 * join disagrees with its transform jumps here, which is the bug a writer that
 * skips its join causes.
 */
function holds(doc: LegoProject, id: string): boolean {
  const { project: resolved, broken } = resolveConnections(doc, pack());
  return (
    !broken.includes(id) &&
    JSON.stringify(round(worldMatrix(resolved, id))) ===
      JSON.stringify(round(worldMatrix(doc, id)))
  );
}

/** A hull on the centre line with a leg joined to one of its faces. */
function legOn(
  to: string,
  extra: Partial<LegoConnection> = {},
  hull: Partial<LegoPiece> = {},
): LegoProject {
  // The leg's own face that points back at the hull's.
  const opposite = `${to[0] === "+" ? "-" : "+"}${to[1]}`;
  return connectPiece(
    project([
      { id: "hull", partId: "hull", ...hull },
      { id: "leg", partId: "leg", parentId: "hull" },
    ]),
    pack(),
    "leg",
    { connector: opposite, to, ...extra },
  );
}

/** The face of the hull that mirrors each face across x = 0. */
const MIRRORED_FACE: Record<string, string> = {
  "+x": "-x",
  "-x": "+x",
  "+y": "+y",
  "-y": "-y",
  "+z": "+z",
  "-z": "-z",
};

const SLID = { offset: [0.3, 0.2] as [number, number], twist: 0.5 };

describe("mirror in place", () => {
  for (const to of Object.keys(MIRRORED_FACE)) {
    it(`joins a piece on the ${to} face to the face that mirrors it`, () => {
      const doc = legOn(to, SLID);
      const out = mirrorPiece(doc, "leg", pack());
      const connection = pieceOf(out, "leg").connection;
      expect(connection?.to).toBe(MIRRORED_FACE[to]);
      expect(connection?.connector).toBe(
        pieceOf(doc, "leg").connection?.connector,
      );
      expect(round(worldMatrix(out, "leg"))).toEqual(reflected(doc, "leg"));
      expect(holds(out, "leg")).toBe(true);
    });
  }

  it("mirroring twice gives back the join it started with", () => {
    const doc = legOn("+x", SLID);
    const twice = mirrorPiece(mirrorPiece(doc, "leg", pack()), "leg", pack());
    const back = pieceOf(twice, "leg").connection;
    const was = pieceOf(doc, "leg").connection as LegoConnection;
    expect(back?.to).toBe(was.to);
    expect(back?.twist).toBeCloseTo(was.twist as number, 9);
    expect(back?.offset?.[0]).toBeCloseTo(was.offset?.[0] as number, 9);
    expect(back?.offset?.[1]).toBeCloseTo(was.offset?.[1] as number, 9);
  });

  it("frees a piece whose parent has no face where its reflection lands", () => {
    // The hull is off to one side, so the leg's reflection is nowhere near it.
    const doc = legOn("+x", {}, { position: [3, 0, 0] });
    const out = mirrorPiece(doc, "leg", pack());
    expect(pieceOf(out, "leg").connection).toBeUndefined();
    expect(round(worldMatrix(out, "leg"))).toEqual(reflected(doc, "leg"));
  });

  it("joins again under a scaled and turned parent", () => {
    const doc = legOn("+x", SLID, {
      scale: [1.5, 2, 1],
      rotation: [0, Math.PI, 0],
    });
    const out = mirrorPiece(doc, "leg", pack());
    expect(pieceOf(out, "leg").connection?.to).toBe("-x");
    expect(round(worldMatrix(out, "leg"))).toEqual(reflected(doc, "leg"));
    expect(holds(out, "leg")).toBe(true);
  });
});

describe("mirror as a copy", () => {
  it("joins the copy to the face that mirrors the source's", () => {
    const doc = legOn("+x", SLID);
    let n = 0;
    const out = mirrorCopy(doc, "leg", () => `n${n++}`, undefined, pack());
    if (!out) throw new Error("no copy");
    const copy = pieceOf(out.project, out.pieceId);
    expect(copy.connection?.to).toBe("-x");
    expect(round(worldMatrix(out.project, out.pieceId))).toEqual(
      reflected(doc, "leg"),
    );
    expect(holds(out.project, out.pieceId)).toBe(true);
    // The source keeps its own join and place.
    expect(pieceOf(out.project, "leg").connection).toEqual(
      pieceOf(doc, "leg").connection,
    );
  });

  it("lands at the reflection under a scaled parent", () => {
    const doc = legOn("+x", SLID, { scale: [2, 1, 1] });
    let n = 0;
    const out = mirrorCopy(doc, "leg", () => `n${n++}`, undefined, pack());
    if (!out) throw new Error("no copy");
    expect(round(worldMatrix(out.project, out.pieceId))).toEqual(
      reflected(doc, "leg"),
    );
    expect(pieceOf(out.project, out.pieceId).connection?.to).toBe("-x");
  });
});

describe("symmetry twin", () => {
  it("is joined to the mirrored face of a part placed on a face (#4291)", () => {
    const placed = placePart(
      project([{ id: "hull", partId: "hull" }]),
      pack(),
      pack().byId.get("leg") as LegoPartInfo,
      { parentId: "hull", to: "+x" },
      { cycle: 0, twist: 1 },
      "new",
    ) as LegoProject;
    const twinned = mirrorTwin(placed, "new", () => "twin", pack());
    if (!twinned) throw new Error("no twin");
    const twin = pieceOf(twinned.project, "twin");
    expect(twin.connection?.to).toBe("-x");
    expect(twin.connection?.connector).toBe(
      pieceOf(placed, "new").connection?.connector,
    );
    expect(round(worldMatrix(twinned.project, "twin"))).toEqual(
      reflected(placed, "new"),
    );
    expect(holds(twinned.project, "twin")).toBe(true);
  });

  it("is joined to the side face of a mirrored parent (#4301)", () => {
    // The twin goes under the hull itself: mirrorTwin would look for a piece
    // whose frame is the hull's reflection, and a mirrored hull has none.
    for (const to of ["+x", "-x"]) {
      const doc = legOn(to, SLID, { scale: [-1, 1, 1] });
      const out = mirrorCopy(doc, "leg", () => "twin", "hull", pack());
      if (!out) throw new Error("no twin");
      const twin = pieceOf(out.project, "twin");
      expect(twin.connection?.to).toBe(MIRRORED_FACE[to]);
      expect(round(worldMatrix(out.project, "twin"))).toEqual(
        reflected(doc, "leg"),
      );
      expect(holds(out.project, "twin")).toBe(true);
      // The twin's joining face is on the hull's face, which is at x = -1 for
      // the mirrored hull's "+x" and x = 1 for its "-x".
      const edge = twin.connection?.connector === "-x" ? -0.25 : 0.5;
      const at = new THREE.Vector3(edge, 0, 0).applyMatrix4(
        worldMatrix(out.project, "twin"),
      );
      expect(Number(at.x.toFixed(5))).toBe(to === "+x" ? 1 : -1);
    }
  });

  it("goes under a mirrored parent on the centre line (#4306)", () => {
    // The hull's reflected frame is the root's, so matching frames alone would
    // put the twin free under the root.
    for (const to of ["+x", "-x"]) {
      const doc = legOn(to, SLID, { scale: [-1, 1, 1] });
      const out = mirrorTwin(doc, "leg", () => "twin", pack());
      if (!out) throw new Error("no twin");
      const twin = pieceOf(out.project, "twin");
      expect(twin.parentId).toBe("hull");
      expect(twin.connection?.to).toBe(MIRRORED_FACE[to]);
      expect(round(worldMatrix(out.project, "twin"))).toEqual(
        reflected(doc, "leg"),
      );
      expect(holds(out.project, "twin")).toBe(true);
    }
  });

  it("joins a child's twin to the mirrored parent", () => {
    // A left thigh with its twin, then a shin under the left thigh.
    const thigh = legOn("+x", SLID);
    const pair = mirrorTwin(thigh, "leg", () => "right", pack());
    if (!pair) throw new Error("no twin");
    const withShin = connectPiece(
      {
        ...pair.project,
        pieces: [
          ...pair.project.pieces,
          { ...pieceOf(pair.project, "leg"), id: "shin", parentId: "leg" },
        ],
      },
      pack(),
      "shin",
      { connector: "+y", to: "-y", offset: [0.1, 0.05], twist: 0.3 },
    );
    let n = 0;
    const twinned = mirrorTwin(withShin, "shin", () => `n${n++}`, pack());
    if (!twinned) throw new Error("no twin");
    const shin = pieceOf(twinned.project, twinned.twinId);
    expect(shin.parentId).toBe("right");
    expect(shin.connection?.to).toBe("-y");
    expect(round(worldMatrix(twinned.project, twinned.twinId))).toEqual(
      reflected(withShin, "shin"),
    );
    expect(holds(twinned.project, twinned.twinId)).toBe(true);
  });

  it("follows its partner sliding along the face, and stays joined", () => {
    const doc = legOn("+x", SLID);
    const pair = mirrorTwin(doc, "leg", () => "twin", pack());
    if (!pair) throw new Error("no twin");
    const slid = connectPiece(pair.project, pack(), "leg", {
      ...(pieceOf(pair.project, "leg").connection as LegoConnection),
      offset: [-0.4, 0.1],
    });
    const out = followMirror(slid, "leg", "twin", pack());
    expect(pieceOf(out, "twin").connection?.to).toBe("-x");
    expect(round(worldMatrix(out, "twin"))).toEqual(reflected(slid, "leg"));
    expect(holds(out, "twin")).toBe(true);
  });

  it("goes free when its partner is dragged off its face", () => {
    const doc = legOn("+x", SLID);
    const pair = mirrorTwin(doc, "leg", () => "twin", pack());
    if (!pair) throw new Error("no twin");
    const dragged = dragPiece(
      pair.project,
      pack(),
      "leg",
      { position: [4, 2, 1], rotation: [0, 0.2, 0], scale: [1, 1, 1] },
      null,
    );
    const out = followMirror(dragged, "leg", "twin", pack());
    expect(pieceOf(out, "twin").connection).toBeUndefined();
    expect(round(worldMatrix(out, "twin"))).toEqual(reflected(dragged, "leg"));
  });
});

describe("duplicate", () => {
  it("keeps the source's join and lands on top of it", () => {
    const doc = legOn("+y", SLID, { scale: [2, 1, 1] });
    let n = 0;
    const out = duplicatePiece(doc, "leg", { now: "", newId: () => `n${n++}` });
    if (!out) throw new Error("no copy");
    expect(pieceOf(out.project, out.rootPieceId).connection).toEqual(
      pieceOf(doc, "leg").connection,
    );
    expect(round(worldMatrix(out.project, out.rootPieceId))).toEqual(
      round(worldMatrix(doc, "leg")),
    );
    expect(holds(out.project, out.rootPieceId)).toBe(true);
  });
});

/** The hull with a leg joined to it, lifted as a compound. */
function liftedHull(): LegoProject {
  let n = 0;
  return selectionAsCompound(legOn("+x", SLID), ["hull"], {
    id: "c",
    now: "",
    newId: () => `c${n++}`,
  }) as LegoProject;
}

/** Where the leg sits against the hull it hangs off. */
function legAgainstHull(doc: LegoProject, hullId: string, legId: string) {
  return round(
    worldMatrix(doc, hullId).invert().multiply(worldMatrix(doc, legId)),
  );
}

describe("copy and paste", () => {
  it("keeps the joins inside what was copied", () => {
    const text = serializeClipboardPiece(liftedHull());
    const parsed = parseClipboardPiece(text, new Set(["hull", "leg"]));
    if (!parsed.ok) throw new Error(parsed.reason);
    let n = 0;
    const target = project([
      { id: "base", partId: "hull", position: [0, 3, 0] },
    ]);
    const out = insertCompound(
      target,
      parsed.piece.project,
      "base",
      () => `p${n++}`,
    );
    const [hull] = out.rootPieceIds;
    const leg = out.project.pieces.find(
      (p) => p.parentId === hull,
    ) as LegoPiece;
    expect(pieceOf(out.project, hull).connection).toBeUndefined();
    expect(leg.connection).toEqual(
      pieceOf(legOn("+x", SLID), "leg").connection,
    );
    expect(holds(out.project, leg.id)).toBe(true);
    expect(legAgainstHull(out.project, hull, leg.id)).toEqual(
      legAgainstHull(legOn("+x", SLID), "hull", "leg"),
    );
  });
});

describe("compounds", () => {
  it("save the joins inside them, and land with them", () => {
    const compound = liftedHull();
    const root = pieceOf(compound, compound.rootPieceId);
    expect(root.connection).toBeUndefined();
    const inner = compound.pieces.find((p) => p.id !== root.id) as LegoPiece;
    expect(inner.connection).toEqual(
      pieceOf(legOn("+x", SLID), "leg").connection,
    );
    expect(holds(compound, inner.id)).toBe(true);

    let n = 0;
    const target = project([{ id: "base", partId: "hull" }]);
    const out = insertCompound(target, compound, "base", () => `l${n++}`);
    const [hull] = out.rootPieceIds;
    const leg = out.project.pieces.find(
      (p) => p.parentId === hull,
    ) as LegoPiece;
    expect(leg.connection).toEqual(inner.connection);
    expect(holds(out.project, leg.id)).toBe(true);
  });
});

describe("every writer of a joined piece's place leaves its join holding", () => {
  const joined = () => legOn("+x", SLID, { scale: [2, 1, 1] });

  it("commitGizmo, through dragPiece", () => {
    const out = dragPiece(
      joined(),
      pack(),
      "leg",
      { position: [3, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      null,
    );
    expect(holds(out, "leg")).toBe(true);
  });

  it("dragGroup and commitGroup, through freeMoved", () => {
    const before = joined();
    const after = {
      ...before,
      pieces: before.pieces.map((p) =>
        p.id === "leg" ? { ...p, position: [3, 1, 0] as Vec3 } : p,
      ),
    };
    expect(holds(freeMoved(before, after), "leg")).toBe(true);
  });

  it("the typed fields, through typedTransform", () => {
    const moved = typedTransform(joined(), "leg", { position: [3, 1, 0] });
    expect(pieceOf(moved, "leg").connection).toBeUndefined();
    expect(holds(moved, "leg")).toBe(true);
    const scaled = typedTransform(joined(), "leg", { scale: [1, 2, 1] });
    expect(pieceOf(scaled, "leg").connection).toBeDefined();
  });

  it("reparentPiece", () => {
    const doc = connectPiece(
      {
        ...joined(),
        pieces: [
          ...joined().pieces,
          {
            ...pieceOf(joined(), "hull"),
            id: "other",
            position: [0, 0, 6],
          },
        ],
      },
      pack(),
      "leg",
      pieceOf(joined(), "leg").connection as LegoConnection,
    );
    expect(holds(reparentPiece(doc, "leg", "other"), "leg")).toBe(true);
  });

  it("mirrorPiece", () => {
    expect(holds(mirrorPiece(joined(), "leg", pack()), "leg")).toBe(true);
  });

  it("followMirror", () => {
    const pair = mirrorTwin(joined(), "leg", () => "twin", pack());
    if (!pair) throw new Error("no twin");
    expect(
      holds(followMirror(pair.project, "leg", "twin", pack()), "twin"),
    ).toBe(true);
  });
});
