import { describe, expect, it } from "vitest";

import type { ImportedPiece, S3oImport } from "./bindings";
import {
  holdsLiftedPieces,
  liftedModuleRefusal,
  liftFromImport,
} from "./liftPiece";
import {
  type LegoProject,
  type LegoUnitGame,
  newProject,
  parseLegoProjectJson,
} from "./model";

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

function lift(path: string) {
  let n = 0;
  return liftFromImport(result(), path, {
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

  it("holds a lifted piece back from a unit of its own game until it can be drawn there", () => {
    const later = {
      ...sf,
      name: "Splinter Faction 0.1.89",
      archive: "sf2.sdz",
    };
    expect(liftedModuleRefusal(unit({ game: later }), lifted())).toBe(
      "Lifted pieces cannot go into a unit yet.",
    );
  });
});
