import { beforeEach, describe, expect, it } from "vitest";
import type { GameItem } from "@/content/bindings";
import { rememberShortnames, resetShortnames } from "../container/shortnames";
import { type LegoProject, newProject } from "./model";
import {
  baseGameOf,
  gameChangeRefusal,
  gameRecordFor,
  installedGameFor,
  liftRefusal,
  sameGame,
  unitGame,
} from "./unitGame";

function project(extra: Partial<LegoProject> = {}): LegoProject {
  return {
    ...newProject({
      id: "p",
      rootPieceId: "root",
      name: "Rover",
      packId: "lego",
      packVersion: "1",
      now: "2026-10-17T00:00:00Z",
    }),
    ...extra,
  };
}

function game(
  name: string,
  archive: string,
  shortname?: string,
  deps: string[] = [],
): GameItem {
  return {
    name,
    primaryArchive: { name: archive, path: `/games/${archive}` },
    dependencyArchives: deps.map((dep) => ({ name: dep })),
    info: shortname ? { shortname, version: name.split(" ").pop() ?? "" } : {},
  };
}

const sf86 = game(
  "Splinter Faction 0.1.86",
  "SplinterFaction_0.1.86.sdz",
  "SF",
  ["springcontent.sdz"],
);
const sf89 = game(
  "Splinter Faction 0.1.89",
  "SplinterFaction_0.1.89.sdz",
  "SF",
  ["springcontent.sdz"],
);
const xta = game("XTA 9.8", "xta_9.8.sdz", "XTA", ["springcontent.sdz"]);
const mutator = game("SF Hover Mod 1", "sfhover.sdd", "SFH", [
  "SplinterFaction_0.1.89.sdz",
  "springcontent.sdz",
]);
const mutatorOfMutator = game("SF Hover Plus 1", "sfhoverplus.sdd", "SFHP", [
  "sfhover.sdd",
  "SplinterFaction_0.1.89.sdz",
  "springcontent.sdz",
]);
const installed = [sf86, sf89, xta, mutator, mutatorOfMutator];

const imported = {
  source: "x.s3o",
  game: {
    name: "Splinter Faction 0.1.86",
    archive: "SplinterFaction_0.1.86.sdz",
    member: "objects3d/a.s3o",
  },
};

beforeEach(() => resetShortnames());

describe("unitGame", () => {
  it("is null for a unit built from parts before this existed", () => {
    expect(unitGame(project())).toBeNull();
  });

  it("is null for a unit for no game, even one opened from a game", () => {
    expect(unitGame(project({ game: null, imported }))).toBeNull();
  });

  it("is the recorded game", () => {
    const record = gameRecordFor(sf89, installed);
    expect(unitGame(project({ game: record }))).toEqual(record);
  });

  it("falls back to the game an old unit was opened from", () => {
    expect(unitGame(project({ imported }))).toEqual({
      name: "Splinter Faction 0.1.86",
      archive: "SplinterFaction_0.1.86.sdz",
    });
  });

  it("does not count the folder a unit was exported into", () => {
    const exported = {
      dir: "/games/SplinterFaction.sdd",
      at: "2026-10-16T00:00:00Z",
      unitName: "rover",
      def: {},
      files: [],
    };
    expect(unitGame(project({ exported }))).toBeNull();
  });
});

describe("gameRecordFor", () => {
  it("keeps the name, the archive, the short name and the version", () => {
    expect(gameRecordFor(sf89, installed)).toEqual({
      name: "Splinter Faction 0.1.89",
      archive: "SplinterFaction_0.1.89.sdz",
      shortname: "SF",
      version: "0.1.89",
    });
  });

  it("records the game a mutator builds on", () => {
    expect(gameRecordFor(mutator, installed).base).toEqual({
      name: "Splinter Faction 0.1.89",
      archive: "SplinterFaction_0.1.89.sdz",
      shortname: "SF",
      version: "0.1.89",
    });
  });

  it("traces a mutator of a mutator to the game under both", () => {
    expect(gameRecordFor(mutatorOfMutator, installed).base?.archive).toBe(
      "SplinterFaction_0.1.89.sdz",
    );
  });

  it("leaves a game with no short name to its archive", () => {
    const bare = game("Odd 1", "odd.sdz");
    expect(gameRecordFor(bare, [bare])).toEqual({
      name: "Odd 1",
      archive: "odd.sdz",
    });
  });
});

describe("baseGameOf", () => {
  it("is null for a game that depends on no other game", () => {
    expect(baseGameOf(sf89, installed)).toBeNull();
  });

  it("survives a loop between two archives", () => {
    const a = game("A 1", "a.sdd", "A", ["b.sdd"]);
    const b = game("B 1", "b.sdd", "B", ["a.sdd"]);
    expect(() => baseGameOf(a, [a, b])).not.toThrow();
  });
});

describe("sameGame", () => {
  it("counts two versions of a game as one game", () => {
    expect(
      sameGame(gameRecordFor(sf86, installed), gameRecordFor(sf89, installed)),
    ).toBe(true);
  });

  it("does not count a game with a different short name", () => {
    expect(
      sameGame(gameRecordFor(sf89, installed), gameRecordFor(xta, installed)),
    ).toBe(false);
  });

  it("counts a mutator as the game it builds on, both ways round", () => {
    const base = gameRecordFor(sf86, installed);
    const mod = gameRecordFor(mutator, installed);
    expect(sameGame(base, mod)).toBe(true);
    expect(sameGame(mod, base)).toBe(true);
  });

  it("never counts no game as a game", () => {
    expect(sameGame(null, null)).toBe(false);
    expect(sameGame(gameRecordFor(sf89, installed), null)).toBe(false);
  });

  it("uses a remembered short name for an old record that has none", () => {
    rememberShortnames([sf86]);
    const old = { name: sf86.name, archive: sf86.primaryArchive.name };
    expect(sameGame(old, gameRecordFor(sf89, installed))).toBe(true);
  });

  it("reads an old record's short name off the installed game", () => {
    const old = { name: sf86.name, archive: sf86.primaryArchive.name };
    expect(sameGame(old, gameRecordFor(sf89, installed), installed)).toBe(true);
  });

  it("traces an old record of a mutator through the installed games", () => {
    const old = { name: mutator.name, archive: mutator.primaryArchive.name };
    expect(sameGame(old, gameRecordFor(sf86, installed), installed)).toBe(true);
  });

  it("falls back to the exact archive when no short name is known", () => {
    const old = { name: "Odd 1", archive: "odd.sdz" };
    expect(sameGame(old, { name: "Odd 1", archive: "odd.sdz" })).toBe(true);
    expect(sameGame(old, { name: "Odd 2", archive: "odd2.sdz" })).toBe(false);
  });
});

describe("installedGameFor", () => {
  it("prefers the exact build", () => {
    expect(
      installedGameFor(gameRecordFor(sf86, installed), installed)?.name,
    ).toBe("Splinter Faction 0.1.86");
  });

  it("finds the newest installed version when the build has gone", () => {
    const gone = { name: "Splinter Faction 0.1.80", archive: "sf80.sdz" };
    expect(
      installedGameFor({ ...gone, shortname: "SF" }, installed)?.name,
    ).toBe("Splinter Faction 0.1.89");
  });

  it("does not offer a mutator in place of the game itself", () => {
    const gone = { name: "Splinter Faction 0.1.80", archive: "sf80.sdz" };
    expect(
      installedGameFor({ ...gone, shortname: "SF" }, [mutator, sf89])?.name,
    ).toBe("Splinter Faction 0.1.89");
  });

  it("is undefined for no game, or a game that is not installed", () => {
    expect(installedGameFor(null, installed)).toBeUndefined();
    expect(
      installedGameFor({ name: "Gone", archive: "gone.sdz" }, installed),
    ).toBeUndefined();
  });
});

describe("gameChangeRefusal", () => {
  const meshUnit = (extra: Partial<LegoProject> = {}) => {
    const base = project({ imported, ...extra });
    return {
      ...base,
      pieces: [
        { ...base.pieces[0], partId: null, meshId: "m0" },
        {
          ...base.pieces[0],
          id: "t",
          name: "turret",
          parentId: base.rootPieceId,
          partId: null,
          meshId: "m1",
        },
      ],
    };
  };

  it("lets a unit of parts change game or go to no game", () => {
    const unit = project({ game: gameRecordFor(sf89, installed) });
    expect(gameChangeRefusal(unit, gameRecordFor(xta, installed))).toBeNull();
    expect(gameChangeRefusal(unit, null)).toBeNull();
  });

  it("lets a unit of parts choose a game later", () => {
    expect(
      gameChangeRefusal(project({ game: null }), gameRecordFor(xta, installed)),
    ).toBeNull();
  });

  it("lets a unit from a game move to another version of it", () => {
    expect(
      gameChangeRefusal(meshUnit(), gameRecordFor(sf89, installed), installed),
    ).toBeNull();
  });

  it("refuses another game, naming the pieces that have to go", () => {
    expect(gameChangeRefusal(meshUnit(), gameRecordFor(xta, installed))).toBe(
      "Remove the pieces from Splinter Faction 0.1.86 first: base, turret.",
    );
  });

  it("refuses no game while it holds pieces from its game", () => {
    expect(gameChangeRefusal(meshUnit(), null)).toBe(
      "Remove the pieces from Splinter Faction 0.1.86 first: base, turret.",
    );
  });
});

describe("liftRefusal", () => {
  const from = gameRecordFor(sf86, installed);

  it("asks a unit for no game to choose one first", () => {
    expect(liftRefusal(project({ game: null }), from)).toBe(
      "This unit is for no game. Choose a game first.",
    );
  });

  it("names both games when they differ", () => {
    const unit = project({ game: gameRecordFor(xta, installed) });
    expect(liftRefusal(unit, from)).toBe(
      "This piece is from Splinter Faction 0.1.86. This unit is for XTA 9.8.",
    );
  });

  it("allows a piece from another version of the unit's game", () => {
    const unit = project({ game: gameRecordFor(sf89, installed) });
    expect(liftRefusal(unit, from)).toBeNull();
  });

  it("refuses a piece that records no game", () => {
    const unit = project({ game: gameRecordFor(sf89, installed) });
    expect(liftRefusal(unit, null)).toBe(
      "This piece does not say which game it is from.",
    );
  });
});
