import { describe, expect, it } from "vitest";
import type { ImportedPiece, S3oImport } from "./bindings";
import {
  parseClipboardPiece,
  pastedForUnit,
  serializeClipboardPiece,
} from "./clipboard";
import {
  duplicatePiece,
  insertCompound,
  selectionAsCompound,
} from "./compounds";
import type { RoleProposal } from "./inferRoles";
import {
  holdsLiftedPieces,
  liftCredit,
  liftCredits,
  liftedModuleRefusal,
  liftFromImport,
  markLifted,
  moduleForUnit,
  openedFrom,
  withMeshBoxes,
} from "./liftPiece";
import {
  type LegoProject,
  type LegoUnitGame,
  newProject,
  parseLegoProjectJson,
  projectProblems,
} from "./model";
import { parseModuleFile, serializeModuleFile } from "./moduleFile";
import { moduleStamp } from "./moduleUpdates";
import { problemTexts } from "./problems";
import type { RawGeometry } from "./rawGeometry";
import { gameChangeRefusal } from "./unitGame";

function piece(
  name: string,
  meshId: string | null,
  children: ImportedPiece[] = [],
  offset: [number, number, number] = [0, 0, 0],
): ImportedPiece {
  return { name, offset, meshId, children };
}

/** A commander: a base, a torso with a turret and its barrel, and a flare. */
function result(): S3oImport {
  return {
    radius: 20,
    height: 30,
    mid: [0, 10, 0],
    root: piece("base", "m0", [
      piece(
        "torso",
        "m1",
        [
          piece(
            "turret",
            "m2",
            [piece("Barrel", "m3", [], [0, 1, 4])],
            [0, 6, 0],
          ),
          piece("flare", null),
        ],
        [0, 10, 0],
      ),
    ]),
    texture: { key: "aa11.dds", name: "arm_1.dds", source: null },
    texture2: { key: "bb22.dds", name: "arm_2.dds", source: null },
    meshes: 4,
    vertices: 400,
    triangles: 200,
    converted: 0,
    bytes: 2048,
  };
}

const sf: LegoUnitGame = {
  name: "Splinter Faction 0.1.86",
  archive: "sf.sdz",
  shortname: "SF",
  version: "0.1.86",
};

function lift(path: string, roles?: RoleProposal[]) {
  let n = 0;
  return liftFromImport(result(), path, {
    ...(roles ? { roles } : {}),
    id: "lifted-1",
    game: sf,
    from: {
      name: sf.name,
      archive: "sf.sdz",
      member: "objects3d/armcom.s3o",
      unit: "armcom",
    },
    source: "/games/sf.sdz/objects3d/armcom.s3o",
    unpacked: true,
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
    newId: () => `id-${++n}`,
  });
}

function unit(extra: Partial<LegoProject> = {}): LegoProject {
  return {
    ...newProject({
      id: "u",
      rootPieceId: "root",
      name: "Rover",
      packId: "lego",
      packVersion: "1",
      now: "2026-10-17T00:00:00Z",
    }),
    ...extra,
  };
}

describe("liftFromImport", () => {
  it("takes the piece and everything under it, and nothing else", () => {
    const lifted = lift("0.0.0");
    expect(lifted?.pieces.map((p) => p.name)).toEqual(["turret", "barrel"]);
    expect(lifted?.pieces.map((p) => p.meshId)).toEqual(["m2", "m3"]);
    expect(lifted?.pieces.every((p) => p.partId === null)).toBe(true);
  });

  it("puts the lifted piece at the origin and keeps the rest where they sat on it", () => {
    const lifted = lift("0.0.0");
    const [turret, barrel] = lifted?.pieces ?? [];
    expect(turret.position).toEqual([0, 0, 0]);
    expect(turret.parentId).toBeNull();
    expect(barrel.position).toEqual([0, 1, 4]);
    expect(barrel.parentId).toBe(turret.id);
    expect(lifted?.rootPieceId).toBe(turret.id);
  });

  it("is named after the unit and the piece", () => {
    expect(lift("0.0.0")?.name).toBe("armcom turret");
  });

  it("uses the id its geometry was stored under", () => {
    expect(lift("0.0.0")?.id).toBe("lifted-1");
  });

  it("records on every piece the game and the unit it came from", () => {
    const lifted = lift("0.0");
    expect(lifted?.pieces.map((p) => p.name)).toEqual([
      "torso",
      "turret",
      "barrel",
      "flare",
    ]);
    for (const p of lifted?.pieces ?? []) {
      expect(p.lifted).toEqual({
        game: sf,
        member: "objects3d/armcom.s3o",
        unit: "armcom",
        // The textures its UVs point onto, with no path to refresh from.
        texture: { key: "aa11.dds", name: "arm_1.dds" },
        texture2: { key: "bb22.dds", name: "arm_2.dds" },
      });
    }
    expect(lifted?.game).toEqual(sf);
  });

  it("keeps the model's textures and where it was read from", () => {
    const lifted = lift("0.0.0");
    expect(lifted?.imported?.texture?.key).toBe("aa11.dds");
    expect(lifted?.imported?.texture2?.key).toBe("bb22.dds");
    expect(lifted?.imported?.game).toEqual({
      name: sf.name,
      archive: "sf.sdz",
      member: "objects3d/armcom.s3o",
      unit: "armcom",
    });
  });

  it("is null for a piece the model does not have", () => {
    expect(lift("0.4")).toBeNull();
  });

  it("survives a save and a load with its records", () => {
    const lifted = lift("0.0.0") as LegoProject;
    const back = parseLegoProjectJson(JSON.stringify(lifted));
    expect(back?.pieces.map((p) => p.lifted)).toEqual(
      lifted.pieces.map((p) => p.lifted),
    );
    expect(back?.game).toEqual(sf);
    expect(back?.imported?.texture?.key).toBe("aa11.dds");
  });
});

describe("holdsLiftedPieces", () => {
  it("is true for a lifted piece and false for a module of parts", () => {
    expect(holdsLiftedPieces(lift("0.0.0") as LegoProject)).toBe(true);
    expect(holdsLiftedPieces(unit())).toBe(false);
  });
});

describe("liftedModuleRefusal", () => {
  const lifted = () => lift("0.0.0") as LegoProject;

  it("lets a module of parts in", () => {
    expect(liftedModuleRefusal(unit({ game: null }), unit())).toBeNull();
  });

  it("refuses a lifted piece in a unit for no game", () => {
    expect(liftedModuleRefusal(unit({ game: null }), lifted())).toBe(
      "This unit is for no game. Choose a game first.",
    );
  });

  it("refuses a lifted piece in a unit for another game", () => {
    const xta = { name: "XTA 9.8", archive: "xta.sdz", shortname: "XTA" };
    expect(liftedModuleRefusal(unit({ game: xta }), lifted())).toBe(
      "This piece is from Splinter Faction 0.1.86. This unit is for XTA 9.8.",
    );
  });

  it("lets a lifted piece into a unit of parts for its own game, in any version", () => {
    const later = {
      ...sf,
      name: "Splinter Faction 0.1.89",
      archive: "sf2.sdz",
    };
    expect(liftedModuleRefusal(unit({ game: later }), lifted())).toBeNull();
  });

  it("refuses a lifted piece in a unit opened whole from a model", () => {
    const opened = unit({
      game: sf,
      imported: { source: "/games/sf.sdz/objects3d/armcom.s3o" },
    });
    expect(liftedModuleRefusal(opened, lifted())).toBe(
      "Lifted pieces go into a unit built from parts, not one opened from a model.",
    );
  });
});

describe("moduleForUnit", () => {
  const lifted = () => lift("0.0.0") as LegoProject;

  it("keys each mesh under the module, so two models' m2 never meet in a unit", () => {
    const { module, keys } = moduleForUnit(lifted());
    expect(module.pieces.map((p) => p.meshId)).toEqual([
      "lifted-1/m2",
      "lifted-1/m3",
    ]);
    expect([...keys]).toEqual([
      ["m2", "lifted-1/m2"],
      ["m3", "lifted-1/m3"],
    ]);
  });

  it("gives every piece the textures it draws with", () => {
    const { module } = moduleForUnit(lifted());
    for (const piece of module.pieces) {
      expect(piece.lifted?.texture).toEqual({
        key: "aa11.dds",
        name: "arm_1.dds",
      });
      expect(piece.lifted?.texture2).toEqual({
        key: "bb22.dds",
        name: "arm_2.dds",
      });
    }
  });

  it("takes the textures off the module for one lifted before pieces kept them", () => {
    const old = lifted();
    const bare = {
      ...old,
      pieces: old.pieces.map((p) => ({
        ...p,
        lifted: p.lifted && {
          game: p.lifted.game,
          member: p.lifted.member,
        },
      })),
    };
    const { module } = moduleForUnit(bare);
    expect(module.pieces[0].lifted?.texture?.key).toBe("aa11.dds");
  });

  it("stamps the same as the module in the inventory, so the unit does not call it out of date", () => {
    const module = lifted();
    expect(moduleStamp(moduleForUnit(module).module)).toBe(moduleStamp(module));
  });

  it("leaves a module of parts as it is", () => {
    const { module, keys } = moduleForUnit(unit());
    expect(module.pieces).toEqual(unit().pieces);
    expect(keys.size).toBe(0);
  });
});

describe("the credit a lifted piece shows", () => {
  const from = {
    game: sf,
    member: "objects3d/armcom.s3o",
    unit: "armcom",
  };

  it("names the game and the unit", () => {
    expect(liftCredit(from)).toBe("From Splinter Faction 0.1.86, unit armcom");
  });

  it("names the model when no unitdef points at it", () => {
    expect(liftCredit({ game: sf, member: "objects3d/wreck.s3o" })).toBe(
      "From Splinter Faction 0.1.86, model objects3d/wreck.s3o",
    );
  });

  it("lists each game and unit once for a whole unit", () => {
    const pieces = lift("0.0")?.pieces ?? [];
    const other = {
      ...pieces[0],
      id: "other",
      lifted: { game: sf, member: "objects3d/armsolar.s3o", unit: "armsolar" },
    };
    const own = { ...pieces[0], id: "own", lifted: undefined };
    expect(liftCredits(unit({ pieces: [...pieces, other, own] }))).toEqual([
      "From Splinter Faction 0.1.86, unit armcom",
      "From Splinter Faction 0.1.86, unit armsolar",
    ]);
  });

  it("lists nothing for a unit built from the pack", () => {
    expect(liftCredits(unit())).toEqual([]);
  });

  it("survives a save and a load", () => {
    const lifted = lift("0.0");
    if (!lifted) throw new Error("no lift");
    const back = parseLegoProjectJson(JSON.stringify(lifted));
    expect(back && liftCredits(back)).toEqual(liftCredits(lifted));
  });
});

/**
 * Issue #3268: every way a lifted piece can reach a unit meets the same rule.
 * A piece lifted from a game is only for units of that game.
 */
describe("a lifted piece in a unit for a different game", () => {
  const xta: LegoUnitGame = {
    name: "XTA 9.8",
    archive: "xta.sdz",
    shortname: "XTA",
  };
  const lifted = () => lift("0.0.0") as LegoProject;
  const PASTE_REFUSAL =
    "This piece is from Splinter Faction 0.1.86. This unit is for XTA 9.8.";
  const ids = () => {
    let n = 0;
    return () => `n${++n}`;
  };

  it("refuses a module with pieces from two games, even when the first is the unit's own", () => {
    const module = lifted();
    const mixed = {
      ...module,
      pieces: module.pieces.map((p, i) =>
        i === 1 && p.lifted ? { ...p, lifted: { ...p.lifted, game: xta } } : p,
      ),
    };
    expect(liftedModuleRefusal(unit({ game: sf }), mixed)).toBe(
      "This piece is from XTA 9.8. This unit is for Splinter Faction 0.1.86.",
    );
  });

  it("refuses a paste of a lifted module, which keeps its record through the clipboard", () => {
    const text = serializeClipboardPiece(lifted(), "other-unit");
    const parsed = parseClipboardPiece(text, new Set());
    if (!parsed.ok) throw new Error(parsed.reason);
    const pasted = pastedForUnit(parsed.piece, "u");
    expect(pasted.pieces.every((p) => p.lifted?.game.shortname === "SF")).toBe(
      true,
    );
    expect(liftedModuleRefusal(unit({ game: xta }), pasted)).toBe(
      PASTE_REFUSAL,
    );
    expect(liftedModuleRefusal(unit({ game: sf }), pasted)).toBeNull();
  });

  it("refuses a paste of meshes copied from a unit opened from a game", () => {
    const opened = lifted();
    // A unit opened from the game: its meshes carry no lifted record.
    const source: LegoProject = {
      ...opened,
      pieces: opened.pieces.map(({ lifted: _l, ...p }) => p),
    };
    expect(openedFrom(source)?.game.shortname).toBe("SF");
    const text = serializeClipboardPiece(
      selectionAsCompound(source, [source.rootPieceId], {
        id: "copy",
        now: "2026-10-17T00:00:00Z",
        newId: ids(),
      }) as LegoProject,
      "opened-unit",
      openedFrom(source),
    );
    const parsed = parseClipboardPiece(text, new Set());
    if (!parsed.ok) throw new Error(parsed.reason);

    const pasted = pastedForUnit(parsed.piece, "u");
    expect(pasted.pieces.every((p) => p.lifted)).toBe(true);
    expect(liftedModuleRefusal(unit({ game: xta }), pasted)).toBe(
      "This piece is from Splinter Faction 0.1.86. This unit is for XTA 9.8.",
    );
    expect(liftedModuleRefusal(unit({ game: null }), pasted)).toBe(
      "This unit is for no game. Choose a game first.",
    );
    // Pasted back where it came from, it stays a plain copy of the unit's own.
    expect(
      pastedForUnit(parsed.piece, "opened-unit").pieces.some((p) => p.lifted),
    ).toBe(false);
  });

  it("marks only meshes that have no record, and leaves parts alone", () => {
    const [root, mesh] = lifted().pieces;
    const part = {
      ...root,
      partId: "barrel_a",
      meshId: undefined,
      lifted: undefined,
    };
    const marked = markLifted(
      { ...lifted(), pieces: [part, { ...mesh, lifted: undefined }] },
      mesh.lifted as NonNullable<typeof mesh.lifted>,
    );
    expect(marked.pieces[0].lifted).toBeUndefined();
    expect(marked.pieces[1].lifted).toBeDefined();
  });

  it("keeps the record on a duplicate, which stays in its own unit", () => {
    const module = lifted();
    const duplicated = duplicatePiece(module, module.rootPieceId, {
      now: "2026-10-17T00:00:00Z",
      newId: ids(),
    });
    expect(duplicated?.project.pieces.every((p) => p.lifted)).toBe(true);
  });

  it("keeps the record when a selection is saved as a module", () => {
    const module = lifted();
    const saved = selectionAsCompound(module, [module.rootPieceId], {
      id: "saved",
      now: "2026-10-17T00:00:00Z",
      newId: ids(),
    }) as LegoProject;
    expect(holdsLiftedPieces(saved)).toBe(true);
    expect(liftedModuleRefusal(unit({ game: xta }), saved)).toBe(PASTE_REFUSAL);
  });

  it("keeps the record through a module file, so a loaded module is still refused", () => {
    const parsed = parseModuleFile(serializeModuleFile(lifted()), new Set());
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(liftedModuleRefusal(unit({ game: xta }), parsed.piece.project)).toBe(
      PASTE_REFUSAL,
    );
  });

  it("flags the piece when a saved unit is opened for a different game", () => {
    const module = lifted();
    const saved = JSON.stringify({ ...module, id: "u", game: xta });
    const opened = parseLegoProjectJson(saved);
    expect(opened).not.toBeNull();
    expect(problemTexts(projectProblems(opened as LegoProject))).toEqual([
      `${PASTE_REFUSAL} Pieces from a game: turret, barrel.`,
    ]);
  });

  it("refuses to change the unit's game while the pieces are in it", () => {
    const base = unit({ game: sf });
    const holding = {
      ...base,
      pieces: [...base.pieces, ...lifted().pieces],
    };
    expect(gameChangeRefusal(holding, xta)).toBe(
      "Remove the pieces from Splinter Faction 0.1.86 first: turret, barrel.",
    );
    expect(gameChangeRefusal(holding, null)).toBe(
      "Remove the pieces from Splinter Faction 0.1.86 first: turret, barrel.",
    );
  });
});

describe("withMeshBoxes (#3269)", () => {
  const raw: RawGeometry = {
    byId: new Map([
      [
        "m2",
        {
          id: "m2",
          vFirst: 0,
          vCount: 0,
          iFirst: 0,
          iCount: 0,
          bbox: { min: [-1, 2, -1], max: [1, 6, 1] },
        },
      ],
    ]),
    vertices: new Float32Array(),
    indices: new Uint32Array(),
  };

  it("records each mesh piece's box from its geometry", () => {
    const module = lift("0.0.0") as LegoProject;
    const boxed = withMeshBoxes(module, raw);
    const turret = boxed.pieces.find((p) => p.meshId === "m2");
    expect(turret?.meshBox).toEqual({ min: [-1, 2, -1], max: [1, 6, 1] });
    // The sidecar holds a mesh for no other piece of this module.
    expect(boxed.pieces.filter((p) => p.meshId && p.meshId !== "m2")).toSatisfy(
      (others: { meshBox?: unknown }[]) =>
        others.every((p) => p.meshBox === undefined),
    );
  });

  it("keeps a box a piece already has and returns the same document when nothing changes", () => {
    const module = lift("0.0.0") as LegoProject;
    const boxed = withMeshBoxes(module, raw);
    expect(withMeshBoxes(boxed, raw)).toBe(boxed);
  });

  it("survives saving", () => {
    const boxed = withMeshBoxes(lift("0.0.0") as LegoProject, raw);
    const back = parseLegoProjectJson(JSON.stringify(boxed));
    expect(back?.pieces.find((p) => p.meshId === "m2")?.meshBox).toEqual({
      min: [-1, 2, -1],
      max: [1, 6, 1],
    });
  });

  it("is dropped from a parsed piece when it is not a box", () => {
    const boxed = withMeshBoxes(lift("0.0.0") as LegoProject, raw);
    const bad = JSON.parse(JSON.stringify(boxed));
    bad.pieces[0].meshBox = { min: [0, 0], max: "x" };
    expect(parseLegoProjectJson(JSON.stringify(bad))?.pieces[0].meshBox).toBe(
      undefined,
    );
  });
});

describe("lifting roles with a turret (#3270)", () => {
  const stated: RoleProposal[] = [
    {
      pieceName: "turret",
      role: "turret",
      evidence: "observed",
      callin: "AimWeapon1",
    },
    {
      pieceName: "barrel",
      role: "barrel",
      evidence: "observed",
      callin: "AimWeapon1",
    },
  ];

  it("lifts geometry only when no roles are passed", () => {
    const lifted = lift("0.0.0");
    expect(lifted?.pieces.some((p) => p.role)).toBe(false);
    expect(lifted?.animations).toBeUndefined();
  });

  it("brings the roles of the lifted pieces and the presets they run", () => {
    const lifted = lift("0.0.0", stated);
    expect(lifted?.pieces.map((p) => p.role)).toEqual(["turret", "barrel"]);
    expect(lifted?.animations?.map((a) => a.presetId)).toEqual([
      "turret.track",
      "recoil",
    ]);
  });

  it("leaves out the roles of pieces that were not lifted", () => {
    const lifted = lift("0.0.0.0", [
      ...stated,
      {
        pieceName: "flare",
        role: "flare",
        evidence: "stated",
        callin: "QueryWeapon1",
      },
    ]);
    expect(lifted?.pieces.map((p) => p.role)).toEqual(["barrel"]);
    expect(lifted?.animations?.map((a) => a.presetId)).toEqual(["recoil"]);
  });

  it("puts the presets on a unit the module is dropped into", () => {
    const lifted = lift("0.0.0", stated);
    let n = 0;
    const inserted = insertCompound(
      unit(),
      lifted as LegoProject,
      "root",
      () => `new-${++n}`,
      true,
    );
    expect(inserted.presets.added).toEqual(["turret.track", "recoil"]);
    expect(inserted.project.animations?.map((a) => a.presetId)).toEqual([
      "turret.track",
      "recoil",
    ]);
    expect(
      inserted.project.pieces.filter((p) => p.role).map((p) => p.role),
    ).toEqual(["turret", "barrel"]);
  });
});
