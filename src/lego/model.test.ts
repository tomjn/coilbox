import { describe, expect, it } from "vitest";

import {
  descendantIds,
  isEffectivelyHidden,
  LEGO_SCHEMA_VERSION,
  type LegoPiece,
  type LegoProject,
  newProject,
  normalisePieceName,
  orderedPieces,
  parseLegoProjectJson,
  pieceKind,
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

describe("isEffectivelyHidden", () => {
  it("is false when neither a piece nor its ancestors are hidden", () => {
    const doc = project([piece("root", null), piece("a", "root")]);
    expect(isEffectivelyHidden(doc, "a")).toBe(false);
  });

  it("is true for a piece hidden on itself", () => {
    const doc = project([
      piece("root", null),
      { ...piece("a", "root"), hidden: true },
    ]);
    expect(isEffectivelyHidden(doc, "a")).toBe(true);
  });

  it("is true for a piece whose ancestor is hidden, even though its own flag is unset", () => {
    const doc = project([
      piece("root", null),
      { ...piece("a", "root"), hidden: true },
      piece("a1", "a"),
    ]);
    expect(isEffectivelyHidden(doc, "a1")).toBe(true);
  });

  it("does not hide a sibling of a hidden piece", () => {
    const doc = project([
      piece("root", null),
      { ...piece("a", "root"), hidden: true },
      piece("b", "root"),
    ]);
    expect(isEffectivelyHidden(doc, "b")).toBe(false);
  });

  it("stops rather than looping when a piece is its own ancestor", () => {
    const doc = project([
      piece("root", null),
      piece("a", "b"),
      piece("b", "a"),
    ]);
    expect(isEffectivelyHidden(doc, "a")).toBe(false);
  });
});

describe("pieceKind", () => {
  it("is geometry when a piece references a part", () => {
    expect(pieceKind({ ...piece("a", null), partId: "leg" })).toBe("geometry");
  });

  it("is empty for a hierarchy node, flare, aim point or emitter", () => {
    expect(pieceKind(piece("a", null))).toBe("empty");
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

  it("records an atlas only when one was asked for", () => {
    const options = {
      id: "p1",
      rootPieceId: "r1",
      name: "My Tank",
      packId: "pack",
      packVersion: "1",
      now: "2026-07-28T00:00:00.000Z",
    };
    // The base pack's atlas is the absence of the key, so a unit built with one
    // atlas installed is stored exactly as it was before atlases were a choice.
    expect(newProject(options)).not.toHaveProperty("atlas");
    expect(newProject({ ...options, atlas: "desert.png" }).atlas).toBe(
      "desert.png",
    );
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

  it("keeps the atlas a unit names, and leaves it off when there is none", () => {
    const doc = { ...project([piece("root", null)]), atlas: "desert.png" };
    expect(parseLegoProjectJson(JSON.stringify(doc))?.atlas).toBe("desert.png");
    // An empty string is not an atlas, and would stop the base one resolving.
    expect(
      parseLegoProjectJson(JSON.stringify({ ...doc, atlas: "" })),
    ).not.toHaveProperty("atlas");
    expect(
      parseLegoProjectJson(JSON.stringify(project([piece("root", null)]))),
    ).not.toHaveProperty("atlas");
  });

  it("keeps a collision volume the unit was saved with", () => {
    const doc = {
      ...project([piece("root", null)]),
      collisionVolume: {
        type: "cylz" as const,
        scales: [10, 10, 40] as [number, number, number],
        offsets: [0, 2, 0] as [number, number, number],
      },
    };
    expect(parseLegoProjectJson(JSON.stringify(doc))?.collisionVolume).toEqual(
      doc.collisionVolume,
    );
  });

  it("leaves a unit saved before volumes existed without one", () => {
    // Absent rather than filled in, so the volume stays derived from whatever
    // the unit's geometry is now rather than frozen at what it was on load.
    expect(
      parseLegoProjectJson(JSON.stringify(project([piece("root", null)]))),
    ).not.toHaveProperty("collisionVolume");
  });

  it("drops a collision volume that is not a whole one", () => {
    const doc = project([piece("root", null)]);
    for (const broken of [
      { type: "cube", scales: [1, 2, 3], offsets: [0, 0, 0] },
      { type: "box", scales: [1, 2], offsets: [0, 0, 0] },
      { type: "box", scales: [1, 2, 3] },
    ]) {
      expect(
        parseLegoProjectJson(
          JSON.stringify({ ...doc, collisionVolume: broken }),
        ),
      ).not.toHaveProperty("collisionVolume");
    }
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

  it("carries the unit's own script through a save and a load", () => {
    const own = "-- mine\nfunction script.Create()\nend\n";
    const doc = { ...project([piece("root", null)]), script: own };

    expect(parseLegoProjectJson(JSON.stringify(doc))?.script).toBe(own);
  });

  it("leaves a unit that owns no script without one", () => {
    const doc = project([piece("root", null)]);

    expect(parseLegoProjectJson(JSON.stringify(doc))).not.toHaveProperty(
      "script",
    );
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
