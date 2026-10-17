import { describe, expect, it } from "vitest";
import { liftedModuleRefusal } from "./liftPiece";
import {
  type LegoLifted,
  type LegoPiece,
  type LegoProject,
  type LegoUnitGame,
  newProject,
} from "./model";
import { parseModuleFile, serializeModuleFile } from "./moduleFile";
import { placeModule } from "./moduleMount";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { swapModule } from "./swapModule";

type Vec3 = [number, number, number];

const sf: LegoUnitGame = {
  name: "Splinter Faction 0.1.86",
  archive: "sf-0.1.86.sdz",
  shortname: "SF",
  version: "0.1.86",
};
const sfLater: LegoUnitGame = {
  name: "Splinter Faction 0.1.89",
  archive: "sf-0.1.89.sdz",
  shortname: "SF",
  version: "0.1.89",
};
const sfMutator: LegoUnitGame = {
  name: "Splinter Faction Mutator 1",
  archive: "sfm-1.sdz",
  shortname: "SFM",
  base: sf,
};
const xta: LegoUnitGame = {
  name: "XTA 9.8",
  archive: "xta.sdz",
  shortname: "XTA",
};

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

function pack(): LoadedPack {
  const parts = [
    part("hull", [-1, -0.5, -2], [1, 0.5, 2]),
    part("leg", [-0.25, -1, -0.25], [0.25, 1, 0.25]),
  ];
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts,
    byId: new Map(parts.map((p) => [p.id, p])),
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  } as LoadedPack;
}

function piece(extra: Partial<LegoPiece> & { id: string }): LegoPiece {
  return {
    name: extra.id,
    parentId: "root",
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...extra,
  };
}

function unit(extra: Partial<LegoProject> = {}): LegoProject {
  const base = newProject({
    id: "u",
    rootPieceId: "root",
    name: "Rover",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    ...extra,
    pieces: [
      ...base.pieces,
      piece({ id: "hull", name: "hull", partId: "hull" }),
    ],
  };
}

function lifted(game: LegoUnitGame): LegoLifted {
  return { game, member: "objects3d/armcom.s3o", unit: "armcom" };
}

/** A module whose one piece joins by its mount. `game` makes it a lifted one. */
function moduleOf(game: LegoUnitGame | null): LegoProject {
  return {
    ...unit(),
    id: "mod",
    name: "mod",
    rootPieceId: "block",
    pieces: [
      piece({
        id: "block",
        name: "block",
        parentId: null,
        partId: "leg",
        ...(game ? { lifted: lifted(game) } : {}),
      }),
    ],
    mount: { piece: "block", connector: "-y" },
  };
}

function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}${n++}`;
}

function place(into: LegoProject, module: LegoProject) {
  return placeModule(
    into,
    module,
    pack(),
    { parentId: "hull", to: "+z" },
    { cycle: 0, twist: 0 },
    counter("a"),
  );
}

/** The module's file text with its pieces rewritten. */
function fileWith(
  module: LegoProject,
  change: (p: Record<string, unknown>) => Record<string, unknown>,
): string {
  const file = JSON.parse(serializeModuleFile(module));
  file.project.pieces = file.project.pieces.map(change);
  return JSON.stringify(file);
}

describe("a module file records the game of every lifted piece", () => {
  it("writes the game on each lifted piece", () => {
    const file = JSON.parse(serializeModuleFile(moduleOf(sf)));
    const games = file.project.pieces.map(
      (p: { lifted?: LegoLifted }) => p.lifted?.game.shortname,
    );
    expect(games).toEqual(["SF"]);
  });

  it("loads a file whose lifted pieces name a game", () => {
    const parsed = parseModuleFile(
      serializeModuleFile(moduleOf(sf)),
      new Set(),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(parsed.piece.project.pieces[0].lifted?.game).toEqual(sf);
  });

  it("loads a module of parts and shapes with nothing recorded", () => {
    const parsed = parseModuleFile(
      serializeModuleFile(moduleOf(null)),
      new Set(),
    );
    expect(parsed.ok).toBe(true);
  });
});

describe("a file whose lifted pieces name no game is refused", () => {
  it("refuses a lifted piece with its game removed, naming the piece", () => {
    const text = fileWith(moduleOf(sf), (p) => ({
      ...p,
      lifted: { member: "objects3d/armcom.s3o", unit: "armcom" },
    }));
    const parsed = parseModuleFile(text, new Set());
    expect(parsed).toEqual({
      ok: false,
      reason:
        "block came from a game, but the file does not say which. A piece from a game only goes in units for that game.",
    });
  });

  it("refuses a lifted record that is not an object", () => {
    const text = fileWith(moduleOf(sf), (p) => ({ ...p, lifted: true }));
    expect(parseModuleFile(text, new Set()).ok).toBe(false);
  });

  it("refuses a game with no name or archive", () => {
    const text = fileWith(moduleOf(sf), (p) => ({
      ...p,
      lifted: { ...lifted(sf), game: {} },
    }));
    expect(parseModuleFile(text, new Set()).ok).toBe(false);
  });
});

describe("a loaded module only goes into a unit for its game", () => {
  it("refuses a unit for another game, saying which", () => {
    expect(liftedModuleRefusal(unit({ game: xta }), moduleOf(sf))).toBe(
      "This piece is from Splinter Faction 0.1.86. This unit is for XTA 9.8.",
    );
  });

  it("refuses a unit for no game", () => {
    expect(liftedModuleRefusal(unit({ game: null }), moduleOf(sf))).toBe(
      "This unit is for no game. Choose a game first.",
    );
  });

  it("lets a module of parts into a unit for no game", () => {
    expect(
      liftedModuleRefusal(unit({ game: null }), moduleOf(null)),
    ).toBeNull();
  });

  it("counts another version of the game as the same game", () => {
    expect(
      liftedModuleRefusal(unit({ game: sfLater }), moduleOf(sf)),
    ).toBeNull();
  });

  it("counts a mutator and the game it builds on as the same game", () => {
    expect(
      liftedModuleRefusal(unit({ game: sfMutator }), moduleOf(sf)),
    ).toBeNull();
    expect(
      liftedModuleRefusal(unit({ game: sf }), moduleOf(sfMutator)),
    ).toBeNull();
  });

  it("refuses a piece that was loaded from a file and is checked as a loaded module", () => {
    const parsed = parseModuleFile(
      serializeModuleFile(moduleOf(sf)),
      new Set(),
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(
      liftedModuleRefusal(unit({ game: xta }), parsed.piece.project),
    ).not.toBeNull();
  });
});

describe("no insert path gets round the refusal", () => {
  it("placeModule puts the module in a unit for its own game", () => {
    expect(place(unit({ game: sfLater }), moduleOf(sf))).not.toBeNull();
  });

  it("placeModule refuses a unit for another game", () => {
    expect(place(unit({ game: xta }), moduleOf(sf))).toBeNull();
  });

  it("placeModule refuses a unit for no game", () => {
    expect(place(unit({ game: null }), moduleOf(sf))).toBeNull();
  });

  it("placeModule puts a module of parts in a unit for no game", () => {
    expect(place(unit({ game: null }), moduleOf(null))).not.toBeNull();
  });

  describe("swapModule", () => {
    function withInstance(game: LegoUnitGame | null): LegoProject {
      const placed = place(unit({ game }), moduleOf(null));
      if (!placed) throw new Error("the module did not place");
      return placed.project;
    }
    const swapped = (project: LegoProject, module: LegoProject) => {
      const instance = project.pieces.find((p) => p.module);
      if (!instance) throw new Error("no instance");
      return swapModule(project, pack(), instance.id, module, counter("b"));
    };

    it("swaps in a module for the unit's own game", () => {
      expect(swapped(withInstance(sfLater), moduleOf(sf))).not.toBeNull();
    });

    it("refuses a module for another game", () => {
      expect(swapped(withInstance(xta), moduleOf(sf))).toBeNull();
    });

    it("refuses a module in a unit for no game", () => {
      expect(swapped(withInstance(null), moduleOf(sf))).toBeNull();
    });
  });
});
