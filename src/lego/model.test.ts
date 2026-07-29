import { describe, expect, it } from "vitest";

import {
  descendantIds,
  LEGO_SCHEMA_VERSION,
  type LegoPiece,
  type LegoProject,
  newProject,
  normalisePieceName,
  orderedPieces,
  parseLegoProjectJson,
  projectProblems,
  uniquePieceName,
  walkPieces,
} from "./model";

function piece(id: string, parentId: string | null, name = id): LegoPiece {
  return {
    id,
    name,
    parentId,
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

function project(pieces: LegoPiece[], rootPieceId = "root"): LegoProject {
  return {
    schemaVersion: LEGO_SCHEMA_VERSION,
    id: "p1",
    name: "Test",
    unitName: "test",
    packId: "pack",
    packVersion: "1",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    rootPieceId,
    pieces,
  };
}

describe("normalisePieceName", () => {
  it("produces something a unit script can use as a local", () => {
    expect(normalisePieceName("Left Foot")).toBe("left_foot");
    expect(normalisePieceName("BARREL-01")).toBe("barrel_01");
    expect(normalisePieceName("  spaced  ")).toBe("spaced");
    // A leading digit is not an identifier, so it gains a prefix.
    expect(normalisePieceName("1foot")).toBe("p1foot");
    expect(normalisePieceName("!!!")).toBe("piece");
  });
});

describe("uniquePieceName", () => {
  it("takes the free name, then the smallest suffix", () => {
    expect(uniquePieceName("Turret", [])).toBe("turret");
    expect(uniquePieceName("Turret", ["turret"])).toBe("turret2");
    expect(uniquePieceName("Turret", ["turret", "turret2"])).toBe("turret3");
  });
});

describe("walkPieces", () => {
  it("walks depth first from the root, which is the export order", () => {
    const doc = project([
      piece("root", null),
      piece("a", "root"),
      piece("a1", "a"),
      piece("b", "root"),
    ]);
    expect(walkPieces(doc).map((p) => p.id)).toEqual(["root", "a", "a1", "b"]);
  });

  it("stops rather than looping when a piece is its own ancestor", () => {
    // `a` and `b` point at each other, so neither is reachable.
    const doc = project([
      piece("root", null),
      piece("a", "b"),
      piece("b", "a"),
    ]);
    expect(walkPieces(doc).map((p) => p.id)).toEqual(["root"]);
  });
});

describe("orderedPieces", () => {
  it("puts a piece after its parent even when the array does not", () => {
    // Reparenting moves a piece in the tree but leaves it where it was in the
    // array, so `a1` sits ahead of its parent `a` here.
    const doc = project([
      piece("root", null),
      piece("a1", "a"),
      piece("a", "root"),
      piece("b", "root"),
    ]);
    expect(orderedPieces(doc).map((p) => p.id)).toEqual([
      "root",
      "a",
      "a1",
      "b",
    ]);
  });

  it("keeps a piece a cycle leaves unreachable, rather than dropping it", () => {
    const doc = project([
      piece("root", null),
      piece("a", "b"),
      piece("b", "a"),
    ]);
    expect(orderedPieces(doc).map((p) => p.id)).toEqual(["root", "a", "b"]);
  });
});

describe("descendantIds", () => {
  it("returns the piece and everything under it", () => {
    const doc = project([
      piece("root", null),
      piece("a", "root"),
      piece("a1", "a"),
      piece("b", "root"),
    ]);
    expect(descendantIds(doc, "a")).toEqual(["a", "a1"]);
  });
});

describe("projectProblems", () => {
  it("says nothing about a sound project", () => {
    expect(
      projectProblems(project([piece("root", null), piece("a", "root")])),
    ).toEqual([]);
  });

  it("catches duplicate names, because a script would address both at once", () => {
    const doc = project([
      piece("root", null),
      piece("a", "root", "turret"),
      piece("b", "root", "turret"),
    ]);
    expect(projectProblems(doc)).toContain('2 pieces are called "turret".');
  });

  it("catches a name a unit script could not use", () => {
    const doc = project([piece("root", null), piece("a", "root", "Left Foot")]);
    expect(projectProblems(doc).join(" ")).toMatch(/not usable as a name/);
  });

  it("catches a cycle rather than recursing forever", () => {
    const doc = project([
      piece("root", null),
      piece("a", "b"),
      piece("b", "a"),
    ]);
    expect(projectProblems(doc).join(" ")).toMatch(/in a loop or detached/);
  });

  it("catches a second root", () => {
    const doc = project([piece("root", null), piece("other", null)]);
    expect(projectProblems(doc).join(" ")).toMatch(/have no parent/);
  });

  it("catches a missing parent", () => {
    const doc = project([piece("root", null), piece("a", "gone")]);
    expect(projectProblems(doc).join(" ")).toMatch(/no longer exists/);
  });
});

describe("newProject", () => {
  it("starts with one empty root, which is what an s3o needs", () => {
    const doc = newProject({
      id: "p1",
      rootPieceId: "r1",
      name: "My Tank",
      packId: "pack",
      packVersion: "1",
      now: "2026-07-28T00:00:00.000Z",
    });

    expect(doc.unitName).toBe("my_tank");
    expect(doc.pieces).toHaveLength(1);
    expect(doc.pieces[0]).toMatchObject({
      id: "r1",
      name: "base",
      partId: null,
    });
    expect(projectProblems(doc)).toEqual([]);
  });
});

describe("parseLegoProjectJson", () => {
  it("round-trips a project it wrote", () => {
    const doc = project([
      piece("root", null),
      { ...piece("a", "root"), partId: "abc", role: "turret" },
    ]);
    expect(parseLegoProjectJson(JSON.stringify(doc))).toEqual(doc);
  });

  it("puts pieces parent-first, for a document saved before that was true", () => {
    const doc = project([
      piece("root", null),
      piece("a1", "a"),
      piece("a", "root"),
    ]);
    const parsed = parseLegoProjectJson(JSON.stringify(doc));
    expect(parsed?.pieces.map((p) => p.id)).toEqual(["root", "a", "a1"]);
  });

  it("loads a project that has problems, rather than refusing to open it", () => {
    // Two pieces called the same thing. Refusing would leave no way to fix it.
    const doc = project([
      piece("root", null),
      piece("a", "root", "turret"),
      piece("b", "root", "turret"),
    ]);
    const parsed = parseLegoProjectJson(JSON.stringify(doc));
    expect(parsed).not.toBeNull();
    expect(projectProblems(parsed as LegoProject)).not.toEqual([]);
  });

  it("fills in transforms a hand-edited file left out", () => {
    const parsed = parseLegoProjectJson(
      JSON.stringify({
        schemaVersion: 1,
        id: "p",
        name: "n",
        rootPieceId: "r",
        pieces: [{ id: "r", name: "base" }],
      }),
    );
    expect(parsed?.pieces[0]).toMatchObject({
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      parentId: null,
      partId: null,
    });
  });

  it("rejects what is not a project at all", () => {
    expect(parseLegoProjectJson("not json")).toBeNull();
    expect(parseLegoProjectJson("[]")).toBeNull();
    expect(
      parseLegoProjectJson(JSON.stringify({ schemaVersion: 99 })),
    ).toBeNull();
    // A version we do not understand, rather than one we can guess at.
    const doc = project([piece("root", null)]);
    expect(
      parseLegoProjectJson(JSON.stringify({ ...doc, schemaVersion: 2 })),
    ).toBeNull();
  });
});
