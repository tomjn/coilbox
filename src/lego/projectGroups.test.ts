import { describe, expect, it } from "vitest";

import type { LegoImported, LegoProject } from "./model";
import { archiveFromSource, groupProjects } from "./projectGroups";

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
