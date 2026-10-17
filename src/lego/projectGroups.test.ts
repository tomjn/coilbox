import { describe, expect, it } from "vitest";

import type { LegoImported, LegoProject } from "./model";
import {
  archiveFromSource,
  carryFoldedKeys,
  filterGrouped,
  groupProjects,
} from "./projectGroups";

function project(
  name: string,
  imported?: LegoImported,
  updatedAt = "2026-08-01T00:00:00.000Z",
): LegoProject {
  return {
    name,
    updatedAt,
    ...(imported ? { imported } : {}),
  } as unknown as LegoProject;
}

describe("archiveFromSource", () => {
  it("finds the loose game folder a model was read out of", () => {
    expect(
      archiveFromSource(
        "/Users/me/.spring/games/SpringMCLegacy.sdd/objects3d/Mech/Adder/SJ_Adder_B.s3o",
      ),
    ).toBe("SpringMCLegacy.sdd");
  });

  it("finds a packed archive in the middle of a path", () => {
    // A packed import records the archive's path with the member on the end,
    // which is a description of where the model was and not a file.
    expect(
      archiveFromSource(
        "/Users/me/games/SplinterFaction_0.1.80.sdz/Objects3D/chickenanarchid.s3o",
      ),
    ).toBe("SplinterFaction_0.1.80.sdz");
  });

  it("takes .sd7 and .sdp too, and keeps the archive's own spelling", () => {
    expect(archiveFromSource("C:\\games\\BA.SD7\\objects3d\\armcom.s3o")).toBe(
      "BA.SD7",
    );
    expect(archiveFromSource("/pool/abcdef.sdp/objects3d/x.s3o")).toBe(
      "abcdef.sdp",
    );
  });

  it("has nothing to give for a model that came from nowhere in particular", () => {
    expect(
      archiveFromSource("/Users/me/Desktop/blender-export.s3o"),
    ).toBeNull();
    expect(archiveFromSource("")).toBeNull();
  });
});

describe("groupProjects", () => {
  it("keeps a unit built out of parts apart from one opened from a model", () => {
    const built = project("Cakebot");
    const opened = project("Commander", {
      source: "/games/Game.sdd/objects3d/armcom.s3o",
      game: { name: "Some Game", archive: "Game.sdd", member: "x.s3o" },
    });

    const grouped = groupProjects([built, opened]);

    expect(grouped.own).toEqual([built]);
    expect(grouped.games).toHaveLength(1);
    expect(grouped.games[0].projects).toEqual([opened]);
    expect(grouped.files).toEqual([]);
  });

  it("groups by the game each unit was opened from, named as unitsync names it", () => {
    const a = project("Adder", {
      source: "",
      game: { name: "MechCommander Legacy", archive: "MCL.sdd", member: "a" },
    });
    const b = project("Anarchid", {
      source: "",
      game: { name: "Splinter Faction", archive: "SF.sdz", member: "b" },
    });
    const c = project("Atlas", {
      source: "",
      game: { name: "MechCommander Legacy", archive: "MCL.sdd", member: "c" },
    });

    const grouped = groupProjects([a, b, c]);

    expect(grouped.games.map((group) => group.label)).toEqual([
      "MechCommander Legacy",
      "Splinter Faction",
    ]);
    expect(grouped.games[0].projects).toEqual([a, c]);
    expect(grouped.games[1].projects).toEqual([b]);
  });

  it("reads the game out of the path for a unit opened before the field existed", () => {
    const old = project("SJ Adder B", {
      source: "/Users/me/.spring/games/SpringMCLegacy.sdd/objects3d/a.s3o",
    });

    const grouped = groupProjects([old]);

    expect(grouped.games).toHaveLength(1);
    expect(grouped.games[0].label).toBe("SpringMCLegacy.sdd");
    expect(grouped.games[0].projects).toEqual([old]);
  });

  it("puts the recorded and the guessed-at in one group when the archive matches", () => {
    // The whole point of grouping on the archive rather than on the name: the
    // same game read two ways is one game, and the recorded name is the better
    // of the two labels.
    const old = project("SJ Adder B", {
      source: "/Users/me/.spring/games/SpringMCLegacy.sdd/objects3d/a.s3o",
    });
    const recorded = project("Atlas", {
      source: "",
      game: {
        name: "MechCommander Legacy",
        archive: "SpringMCLegacy.sdd",
        member: "b",
      },
    });

    const grouped = groupProjects([old, recorded]);

    expect(grouped.games).toHaveLength(1);
    expect(grouped.games[0].label).toBe("MechCommander Legacy");
    expect(grouped.games[0].projects).toEqual([old, recorded]);
  });

  it("matches an archive whatever case the path spells it in", () => {
    const lower = project("One", {
      source: "/games/springmclegacy.sdd/objects3d/a.s3o",
    });
    const upper = project("Two", {
      source: "/games/SpringMCLegacy.SDD/objects3d/b.s3o",
    });

    expect(groupProjects([lower, upper]).games).toHaveLength(1);
  });

  it("says a unit came from a file rather than inventing a game for it", () => {
    const loose = project("Blender export", {
      source: "/Users/me/Desktop/thing.s3o",
    });

    const grouped = groupProjects([loose]);

    expect(grouped.own).toEqual([]);
    expect(grouped.games).toEqual([]);
    expect(grouped.files).toEqual([loose]);
  });

  it("keeps the order it was given, which is newest first", () => {
    const older = project("Older", {
      source: "",
      game: { name: "Game", archive: "G.sdd", member: "a" },
    });
    const newer = project("Newer", {
      source: "",
      game: { name: "Game", archive: "G.sdd", member: "b" },
    });

    expect(groupProjects([newer, older]).games[0].projects).toEqual([
      newer,
      older,
    ]);
  });
});

describe("filterGrouped", () => {
  const adder = {
    ...project("Adder", {
      source: "",
      game: { name: "MechCommander Legacy", archive: "MCL.sdd", member: "a" },
    }),
    unitName: "sj_adder",
  } as LegoProject;
  const atlas = {
    ...project("Atlas", {
      source: "",
      game: { name: "MechCommander Legacy", archive: "MCL.sdd", member: "b" },
    }),
    unitName: "sj_atlas",
  } as LegoProject;
  const cakebot = { ...project("Cakebot"), unitName: "cake" } as LegoProject;
  const loose = {
    ...project("Blender thing", { source: "/Desktop/thing.s3o" }),
    unitName: "thing",
  } as LegoProject;
  const all = groupProjects([adder, atlas, cakebot, loose]);

  it("changes nothing for a blank search", () => {
    expect(filterGrouped(all, "")).toBe(all);
    expect(filterGrouped(all, "   ")).toBe(all);
  });

  it("finds a unit of parts by the game it is for (#3257)", () => {
    const rover = {
      ...cakebot,
      id: "rover",
      name: "Rover",
      unitName: "rover",
      game: { name: "Splinter Faction 0.1.89", archive: "sf.sdz" },
    } as LegoProject;
    const found = filterGrouped(
      groupProjects([adder, rover, cakebot]),
      "splinter",
    );
    expect(found.games[0].projects).toEqual([rover]);
    expect(found.own).toEqual([]);
  });

  it("keeps the units whose name or unit name matches, in any case", () => {
    const found = filterGrouped(all, "ADD");
    expect(found.games).toHaveLength(1);
    expect(found.games[0].projects).toEqual([adder]);
    expect(found.own).toEqual([]);
    expect(found.files).toEqual([]);
    expect(filterGrouped(all, "cake").own).toEqual([cakebot]);
    expect(filterGrouped(all, "thing").files).toEqual([loose]);
  });

  it("brings a whole game when its name matches", () => {
    const found = filterGrouped(all, "mechcommander");
    expect(found.games[0].projects).toEqual([adder, atlas]);
  });

  it("drops a game with nothing left in it", () => {
    expect(filterGrouped(all, "cakebot").games).toEqual([]);
  });
});

describe("one section per game (#4328)", () => {
  const sf88 = {
    name: "Splinter Faction 0.1.88",
    archive: "SplinterFaction_0.1.88.sdz",
    shortname: "SF",
  };
  const sf89 = {
    name: "Splinter Faction 0.1.89",
    archive: "SplinterFaction_0.1.89.sdz",
    shortname: "SF",
  };
  const mutator = {
    name: "SF Hardmode",
    archive: "SFHard_1.sdz",
    shortname: "SFHard",
    base: sf89,
  };
  const forGame = (name: string, game: object | null) =>
    ({ ...project(name), game }) as unknown as LegoProject;
  const openedFrom = (name: string, game: typeof sf88) =>
    project(name, {
      source: "",
      game: { name: game.name, archive: game.archive, member: "x" },
    });

  it("puts two versions of one game in one section, labelled with the newest", () => {
    const a = forGame("Old build", sf88);
    const b = forGame("New build", sf89);

    const grouped = groupProjects([a, b]);

    expect(grouped.own).toEqual([]);
    expect(grouped.games).toHaveLength(1);
    expect(grouped.games[0].label).toBe("Splinter Faction 0.1.89");
    expect(grouped.games[0].projects).toEqual([a, b]);
    expect(grouped.games[0].archives.sort()).toEqual([
      "splinterfaction_0.1.88.sdz",
      "splinterfaction_0.1.89.sdz",
    ]);
  });

  it("shares a section between a mutator and the game it builds on", () => {
    const base = forGame("Base", sf88);
    const mod = forGame("Mod", mutator);

    const grouped = groupProjects([mod, base]);

    expect(grouped.games).toHaveLength(1);
    expect(grouped.games[0].label).toBe("Splinter Faction 0.1.89");
    expect(grouped.games[0].projects).toEqual([mod, base]);
  });

  it("lists built units before opened ones, with no split inside", () => {
    const opened = openedFrom("Opened", sf88);
    const built = forGame("Built", sf89);
    const opened2 = openedFrom("Opened 2", sf89);

    // Opened units carry no `shortname` on their import, so the installed
    // games supply it the way an old record's would.
    const installed = [
      {
        name: sf88.name,
        primaryArchive: { name: sf88.archive },
        info: { shortname: "SF" },
      },
      {
        name: sf89.name,
        primaryArchive: { name: sf89.archive },
        info: { shortname: "SF" },
      },
    ] as never;
    const grouped = groupProjects([opened, built, opened2], installed);

    expect(grouped.games).toHaveLength(1);
    expect(grouped.games[0].projects).toEqual([built, opened, opened2]);
  });

  it("keeps units for no game in a section of their own", () => {
    const none = forGame("Parts only", null);
    const unset = project("Never chose");
    const sf = forGame("Mine", sf89);
    const loose = project("Loose", { source: "/Desktop/x.s3o" });

    const grouped = groupProjects([none, sf, unset, loose]);

    expect(grouped.own).toEqual([none, unset]);
    expect(grouped.files).toEqual([loose]);
    expect(grouped.games[0].projects).toEqual([sf]);
  });

  it("keeps different games apart", () => {
    const other = forGame("Other", {
      name: "Other Game",
      archive: "other.sdz",
      shortname: "OG",
    });
    const grouped = groupProjects([forGame("Mine", sf89), other]);
    expect(grouped.games.map((g) => g.label)).toEqual([
      "Other Game",
      "Splinter Faction 0.1.89",
    ]);
  });
});

describe("carryFoldedKeys (#4328)", () => {
  const group = {
    key: "short:sf",
    label: "Splinter Faction",
    archives: ["splinterfaction_0.1.88.sdz", "splinterfaction_0.1.89.sdz"],
    projects: [],
  };

  it("replaces a folded archive key with the game's key", () => {
    const saved = new Set(["splinterfaction_0.1.88.sdz", "other.sdz"]);
    expect([...carryFoldedKeys(saved, [group])].sort()).toEqual([
      "other.sdz",
      "short:sf",
    ]);
  });

  it("returns the same set when nothing needs carrying", () => {
    const saved = new Set(["short:sf", "other.sdz"]);
    expect(carryFoldedKeys(saved, [group])).toBe(saved);
  });
});
