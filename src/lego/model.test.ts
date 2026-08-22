import { describe, expect, it } from "vitest";

import {
  descendantIds,
  isEffectivelyHidden,
  isLooseArchive,
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

describe("isLooseArchive", () => {
  it("is only a .sdd, whatever case it is written in", () => {
    expect(isLooseArchive("SplinterFaction.SDD")).toBe(true);
    expect(isLooseArchive("balanced_annihilation-v15.9.8.sdz")).toBe(false);
    expect(isLooseArchive("abc123.sdp")).toBe(false);
    // A map's archive is named rather than spelled as a file, which is not a
    // folder either.
    expect(isLooseArchive("Ancient Vault v1.4")).toBe(false);
  });
});

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

  it("is geometry when a piece references an imported mesh", () => {
    expect(pieceKind({ ...piece("a", null), meshId: "m3" })).toBe("geometry");
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

  it("round-trips a piece's own collision volume (#1842)", () => {
    const doc = project([
      piece("root", null),
      {
        ...piece("dish", "root"),
        collision: {
          hit: true,
          volume: {
            type: "box" as const,
            scales: [30, 4, 30] as [number, number, number],
            offsets: [0, 2, 0] as [number, number, number],
          },
        },
      },
    ]);

    expect(parseLegoProjectJson(JSON.stringify(doc))).toEqual(doc);
  });

  it("round-trips a piece switched off with no volume of its own", () => {
    const doc = project([
      piece("root", null),
      { ...piece("aerial", "root"), collision: { hit: false } },
    ]);

    expect(
      parseLegoProjectJson(JSON.stringify(doc))?.pieces[1].collision,
    ).toEqual({ hit: false });
  });

  it("drops a collision record that says nothing, so overrides stay countable", () => {
    // A piece switched off and back on again leaves { hit: true } behind, which
    // is the derived box. Keeping it would make "does this unit override
    // anything" answer yes for a unit that overrides nothing, and that question
    // decides whether the script gets an include line.
    const doc = project([
      piece("root", null),
      { ...piece("aerial", "root"), collision: { hit: true } },
    ]);

    expect(
      parseLegoProjectJson(JSON.stringify(doc))?.pieces[1].collision,
    ).toBeUndefined();
  });

  it("drops a half-written piece volume rather than keeping half a shape", () => {
    // Half derived and half set, with nothing to say which half, is the same
    // call the unit's own volume makes. Written as text because the type will
    // not let a half-written volume be built here.
    const json = JSON.stringify(
      project([piece("root", null), piece("dish", "root")]),
    ).replace(
      '"name":"dish"',
      '"name":"dish","collision":{"hit":true,"volume":{"type":"box"}}',
    );

    expect(parseLegoProjectJson(json)?.pieces[1].collision).toBeUndefined();
  });

  it("round-trips an imported unit's meshes and textures", () => {
    const doc = {
      ...project([
        piece("root", null),
        { ...piece("a", "root"), meshId: "m1" },
      ]),
      imported: {
        source: "/game/objects3d/Beacon.s3o",
        texture: {
          key: "aa11.dds",
          name: "Beacon_1.dds",
          source: "/game/unittextures/Beacon_1.dds",
        },
        texture2: { key: "bb22.dds", name: "Beacon_2.dds" },
        missingTexture2: undefined,
      },
    };

    const parsed = parseLegoProjectJson(JSON.stringify(doc));

    expect(parsed?.imported?.texture?.key).toBe("aa11.dds");
    expect(parsed?.imported?.texture2?.name).toBe("Beacon_2.dds");
    expect(parsed?.pieces[1].meshId).toBe("m1");
  });

  it("reads a second texture written under the old teamMask name", () => {
    // Every unit saved before #1910 spells it that way. Reading it here is the
    // whole migration: the parse writes the new name out, so a unit moves over
    // the next time it is saved without anybody re-importing it.
    const doc = {
      ...project([piece("root", null)]),
      imported: {
        source: "/game/objects3d/Beacon.s3o",
        texture: { key: "aa11.dds", name: "Beacon_1.dds" },
        teamMask: { key: "bb22.dds", name: "Beacon_2.dds" },
        missingTeamMask: "Beacon_3.dds",
      },
    };

    const parsed = parseLegoProjectJson(JSON.stringify(doc));

    expect(parsed?.imported?.texture2).toEqual({
      key: "bb22.dds",
      name: "Beacon_2.dds",
    });
    expect(parsed?.imported?.missingTexture2).toBe("Beacon_3.dds");
    // The old spellings do not survive the trip, so a saved document carries
    // one name for the field rather than two free to disagree.
    expect(JSON.stringify(parsed)).not.toContain("teamMask");
  });

  it("prefers the new name when a document somehow carries both", () => {
    const doc = {
      ...project([piece("root", null)]),
      imported: {
        source: "/game/objects3d/Beacon.s3o",
        texture2: { key: "new.dds", name: "New_2.dds" },
        teamMask: { key: "old.dds", name: "Old_2.dds" },
      },
    };

    expect(
      parseLegoProjectJson(JSON.stringify(doc))?.imported?.texture2?.key,
    ).toBe("new.dds");
  });

  it("round-trips the game an imported unit was opened out of", () => {
    // Written by the picker and read by the units page, so a field that does
    // not survive the trip through disk is a field nothing ever sees.
    const doc = {
      ...project([piece("root", null)]),
      imported: {
        source: "/games/Game.sdd/objects3d/armcom.s3o",
        game: {
          name: "Some Game",
          archive: "Game.sdd",
          member: "objects3d/armcom.s3o",
          unit: "armcom",
        },
      },
    };

    const parsed = parseLegoProjectJson(JSON.stringify(doc));

    expect(parsed?.imported?.game).toEqual(doc.imported.game);
  });

  it("keeps an imported unit when half a game is recorded on it", () => {
    const doc = {
      ...project([piece("root", null)]),
      imported: {
        source: "/games/Game.sdd/objects3d/armcom.s3o",
        game: { name: "Some Game" },
      },
    };

    const parsed = parseLegoProjectJson(JSON.stringify(doc));

    expect(parsed?.imported?.source).toBe(
      "/games/Game.sdd/objects3d/armcom.s3o",
    );
    expect(parsed?.imported?.game).toBeUndefined();
  });

  it("takes a game with no unitdef naming it, which is a feature or a wreck", () => {
    const doc = {
      ...project([piece("root", null)]),
      imported: {
        source: "/games/Game.sdd/objects3d/wreck.s3o",
        game: {
          name: "Some Game",
          archive: "Game.sdd",
          member: "objects3d/wreck.s3o",
        },
      },
    };

    expect(
      parseLegoProjectJson(JSON.stringify(doc))?.imported?.game?.unit,
    ).toBe(undefined);
    expect(
      parseLegoProjectJson(JSON.stringify(doc))?.imported?.game?.archive,
    ).toBe("Game.sdd");
  });

  it("drops the texture source of a unit that came out of a packed archive", () => {
    // Saved before the import stopped recording one. The path is a temp folder
    // that has long since gone, so a Refresh against it can only fail (#1903).
    const doc = {
      ...project([piece("root", null)]),
      imported: {
        source: "/games/game.sdz/objects3d/armcom.s3o",
        game: {
          name: "Some Game",
          archive: "game.sdz",
          member: "objects3d/armcom.s3o",
        },
        texture: {
          key: "aa11.dds",
          name: "Beacon_1.dds",
          source: "/tmp/coilbox-lego-model-1/unittextures/Beacon_1.dds",
        },
        texture2: {
          key: "bb22.dds",
          name: "Beacon_2.dds",
          source: "/tmp/coilbox-lego-model-1/unittextures/Beacon_2.dds",
        },
      },
    };

    const parsed = parseLegoProjectJson(JSON.stringify(doc));

    expect(parsed?.imported?.texture).toEqual({
      key: "aa11.dds",
      name: "Beacon_1.dds",
    });
    expect(parsed?.imported?.texture2?.source).toBeUndefined();
  });

  it("keeps the texture source of a unit out of a loose game folder", () => {
    // A `.sdd` is a folder, so the file it named is still that file.
    const doc = {
      ...project([piece("root", null)]),
      imported: {
        source: "/games/Game.sdd/objects3d/armcom.s3o",
        game: {
          name: "Some Game",
          archive: "Game.sdd",
          member: "objects3d/armcom.s3o",
        },
        texture: {
          key: "aa11.dds",
          name: "Beacon_1.dds",
          source: "/games/Game.sdd/unittextures/Beacon_1.dds",
        },
      },
    };

    const parsed = parseLegoProjectJson(JSON.stringify(doc));

    expect(parsed?.imported?.texture?.source).toBe(
      "/games/Game.sdd/unittextures/Beacon_1.dds",
    );
  });

  it("keeps the texture source of a model chosen with the file dialog", () => {
    // No game recorded at all, so the path is one somebody pointed at.
    const doc = {
      ...project([piece("root", null)]),
      imported: {
        source: "/home/me/Beacon.s3o",
        texture: {
          key: "aa11.dds",
          name: "Beacon_1.dds",
          source: "/home/me/unittextures/Beacon_1.dds",
        },
      },
    };

    expect(
      parseLegoProjectJson(JSON.stringify(doc))?.imported?.texture?.source,
    ).toBe("/home/me/unittextures/Beacon_1.dds");
  });

  it("keeps an imported unit when one of its textures will not parse", () => {
    const doc = {
      ...project([piece("root", null)]),
      imported: {
        source: "/game/objects3d/Beacon.s3o",
        // Half a texture is not one, and losing the whole unit over it would be
        // worse than drawing it untextured.
        texture: { name: "Beacon_1.dds" },
      },
    };

    const parsed = parseLegoProjectJson(JSON.stringify(doc));

    expect(parsed?.imported?.source).toBe("/game/objects3d/Beacon.s3o");
    expect(parsed?.imported?.texture).toBeUndefined();
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

  it("keeps piece collision on, and leaves it off for everyone else", () => {
    const doc = project([piece("root", null)]);
    expect(
      parseLegoProjectJson(JSON.stringify({ ...doc, pieceCollision: true }))
        ?.pieceCollision,
    ).toBe(true);
    expect(parseLegoProjectJson(JSON.stringify(doc))).not.toHaveProperty(
      "pieceCollision",
    );
  });

  it("keeps piece selection on, and leaves it off for everyone else", () => {
    const doc = project([piece("root", null)]);
    expect(
      parseLegoProjectJson(JSON.stringify({ ...doc, pieceSelection: true }))
        ?.pieceSelection,
    ).toBe(true);
    expect(parseLegoProjectJson(JSON.stringify(doc))).not.toHaveProperty(
      "pieceSelection",
    );
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

  /**
   * A unit whose game compiled its animation carries the bytecode, because it
   * is the only copy of that animation coilbox has: the game archive it came
   * out of may not be installed the next time the project is opened.
   */
  it("carries a compiled script through a save and a load", () => {
    const compiled = { member: "scripts/armcom.cob", bytes: [4, 0, 0, 0] };
    const doc = { ...project([piece("root", null)]), compiledScript: compiled };

    expect(parseLegoProjectJson(JSON.stringify(doc))?.compiledScript).toEqual(
      compiled,
    );
  });

  it("drops a compiled script with nothing in it", () => {
    const doc = {
      ...project([piece("root", null)]),
      compiledScript: { member: "scripts/armcom.cob", bytes: [] },
    };

    expect(parseLegoProjectJson(JSON.stringify(doc))).not.toHaveProperty(
      "compiledScript",
    );
  });

  it("loads a project that has problems, rather than refusing to open it", () => {
    // `a` hangs off a parent that no longer exists. Refusing to open the
    // project would leave no way to fix it.
    const doc = project([piece("root", null), piece("a", "ghost")]);
    const parsed = parseLegoProjectJson(JSON.stringify(doc));
    expect(parsed).not.toBeNull();
    expect(projectProblems(parsed as LegoProject)).not.toEqual([]);
  });

  it("normalises an imported piece name, the same way the editor does", () => {
    // `parsePiece` is the only write path that does not already go through
    // `normalisePieceName`, since it is reachable from clipboard/JSON import
    // rather than the editor UI. A name with punctuation would otherwise
    // become an invalid Lua identifier the moment the document is a script.
    const doc = project([
      piece("root", null),
      piece("a", "root", 'wheel"); os.execute("rm'),
    ]);
    const parsed = parseLegoProjectJson(JSON.stringify(doc));
    expect(parsed?.pieces[1].name).toBe(
      normalisePieceName('wheel"); os.execute("rm'),
    );
    expect(projectProblems(parsed as LegoProject)).toEqual([]);
  });

  it("makes two imported pieces that normalise the same way unique", () => {
    // Two different hostile names, "wheel!" and "wheel?", both collapse to
    // "wheel" under normalisePieceName. Left alone that is two pieces sharing
    // one Lua local, and the second declaration silently shadows the first,
    // binding the wrong piece to any code that references it by name.
    const doc = project([
      piece("root", null),
      piece("a", "root", "wheel!"),
      piece("b", "root", "wheel?"),
    ]);
    const parsed = parseLegoProjectJson(JSON.stringify(doc));
    const names = parsed?.pieces.slice(1).map((p) => p.name);
    expect(names).toEqual(["wheel", "wheel2"]);
    expect(new Set(names).size).toBe(2);
    expect(projectProblems(parsed as LegoProject)).toEqual([]);
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
