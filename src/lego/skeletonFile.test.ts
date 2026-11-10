import { describe, expect, it } from "vitest";
import type { BlueprintFileIO } from "@/blueprint/gameFile";
import type { GameItem } from "@/content/bindings";
import type { LegoPiece, LegoProject } from "./model";
import {
  contentRootOfGameFolder,
  folderGameShortname,
  mergeSkeletonFile,
  type SkeletonUnitEntry,
  skeletonFileName,
  skeletonFilePath,
  skeletonGameShortname,
  unitSkeletonEntry,
  writeSkeletonFiles,
} from "./skeletonFile";

function piece(name: string, over: Partial<LegoPiece> = {}): LegoPiece {
  return { id: name, name, ...over } as LegoPiece;
}

function unit(
  unitName: string,
  over: Partial<LegoProject> = {},
  fitted = false,
): LegoProject {
  return {
    id: unitName,
    unitName,
    game: { name: "Test Game 1.0", archive: "test_game_1.0", shortname: "TG" },
    skeleton: {
      plan: "biped",
      proportions: {},
      ...(fitted ? { fitted: true } : {}),
    },
    pieces: [
      piece("body", { bone: "body", role: "base" }),
      piece("lthigh", { bone: "thigh.l1", role: "leg.l1.thigh" }),
      piece("tag", { bone: "tag" }),
      piece("plate"),
    ],
    ...over,
  } as unknown as LegoProject;
}

const entry = (
  evidence: SkeletonUnitEntry["evidence"],
  name = "body",
): SkeletonUnitEntry => ({
  evidence,
  pieces: { [name]: { bone: name, label: name } },
});

describe("unitSkeletonEntry", () => {
  it("lists each bone's piece with its bone id and role label", () => {
    const written = unitSkeletonEntry(unit("fedwalker"));
    expect(written?.evidence).toBe("built");
    expect(Object.keys(written?.pieces ?? {})).toEqual([
      "body",
      "lthigh",
      "tag",
    ]);
    expect(written?.pieces.lthigh.bone).toBe("thigh.l1");
    expect(written?.pieces.lthigh.label).not.toBe("");
    expect(written?.pieces.lthigh.label).not.toBe("leg.l1.thigh");
  });

  it("labels a bone with no role by its piece's name, as the builder does", () => {
    expect(unitSkeletonEntry(unit("fedwalker"))?.pieces.tag.label).toBe("tag");
  });

  it("lists a piece from a game's model under the name it came with too", () => {
    const written = unitSkeletonEntry(
      unit("fedwalker", {
        pieces: [
          piece("left_thigh", { bone: "thigh.l1", originalName: "LThigh" }),
        ],
      }),
    );
    expect(Object.keys(written?.pieces ?? {})).toEqual([
      "left_thigh",
      "LThigh",
    ]);
    expect(written?.pieces.LThigh).toEqual(written?.pieces.left_thigh);
  });

  it("says fitted for a plan fitted to pieces the unit had", () => {
    expect(unitSkeletonEntry(unit("fedwalker", {}, true))?.evidence).toBe(
      "fitted",
    );
  });

  it("is null for a unit with no skeleton, and for one with no bone", () => {
    expect(unitSkeletonEntry(unit("a", { skeleton: undefined }))).toBeNull();
    expect(
      unitSkeletonEntry(unit("a", { pieces: [piece("plate")] })),
    ).toBeNull();
  });
});

describe("the file's place", () => {
  it("is one file for each game under the content root", () => {
    expect(skeletonFilePath("/home/p/.spring", "sf")).toBe(
      "/home/p/.spring/LuaUI/Config/coilbox_skeletons/sf.json",
    );
  });

  it("changes what a file name cannot hold, as the widget does", () => {
    expect(skeletonFileName("a b/c")).toBe("a_b_c.json");
  });

  it("finds the content root of a game folder, and nothing for another folder", () => {
    expect(contentRootOfGameFolder("/home/p/.spring/games/mod.sdd")).toBe(
      "/home/p/.spring",
    );
    expect(contentRootOfGameFolder("C:\\Spring\\games\\mod.sdd\\")).toBe(
      "C:\\Spring",
    );
    expect(contentRootOfGameFolder("/home/p/mods/mod.sdd")).toBeNull();
    expect(contentRootOfGameFolder("/games/mod.sdd")).toBeNull();
  });
});

describe("mergeSkeletonFile", () => {
  it("writes a version 1 file for no file", () => {
    const file = JSON.parse(mergeSkeletonFile(null, { a: entry("built") }));
    expect(file).toEqual({ version: 1, units: { a: entry("built") } });
  });

  it("keeps units it is not given, and keys other writers own", () => {
    const before = JSON.stringify({
      version: 1,
      coilbox_test_unit: "b",
      units: { b: entry("observed", "hull") },
    });
    const file = JSON.parse(mergeSkeletonFile(before, { a: entry("built") }));
    expect(file.coilbox_test_unit).toBe("b");
    expect(Object.keys(file.units)).toEqual(["b", "a"]);
  });

  it("replaces a unit's entry with a newer built one", () => {
    const before = mergeSkeletonFile(null, { a: entry("observed", "old") });
    const file = JSON.parse(
      mergeSkeletonFile(before, { a: entry("fitted", "new") }),
    );
    expect(file.units.a).toEqual(entry("fitted", "new"));
  });

  it("never lets an observed entry replace a built or fitted one", () => {
    for (const held of ["built", "fitted"] as const) {
      const before = mergeSkeletonFile(null, { a: entry(held, "kept") });
      const file = JSON.parse(
        mergeSkeletonFile(before, {
          a: entry("observed", "seen"),
          b: entry("observed", "seen"),
        }),
      );
      expect(file.units.a).toEqual(entry(held, "kept"));
      expect(file.units.b.evidence).toBe("observed");
    }
  });

  it("refuses a file it cannot read rather than writing over it", () => {
    expect(() => mergeSkeletonFile("{ nope", {})).toThrow(/not JSON/);
    expect(() => mergeSkeletonFile("[]", {})).toThrow(/not an object/);
    expect(() => mergeSkeletonFile('{"version": 2}', {})).toThrow(/version 2/);
  });
});

describe("skeletonGameShortname", () => {
  it("is the game's short name, and a mutator's is its base game's", () => {
    expect(skeletonGameShortname(unit("a"))).toBe("TG");
    expect(
      skeletonGameShortname(
        unit("a", {
          game: {
            name: "Mutator",
            archive: "mutator",
            shortname: "MUT",
            base: { name: "Base", archive: "base", shortname: "BASE" },
          },
        }),
      ),
    ).toBe("BASE");
  });

  it("is null for a unit of no game", () => {
    expect(skeletonGameShortname(unit("a", { game: null }))).toBeNull();
  });
});

/** A filesystem in a map. */
function memory(initial: Record<string, string> = {}) {
  const disk = new Map(Object.entries(initial));
  const writes: string[] = [];
  const io: BlueprintFileIO = {
    read: async (path) => disk.get(path) ?? null,
    write: async (path, text) => {
      writes.push(path);
      disk.set(path, text);
    },
  };
  return { io, disk, writes };
}

describe("writeSkeletonFiles", () => {
  const ROOT = "/data";
  const PATH = "/data/LuaUI/Config/coilbox_skeletons/TG.json";

  it("writes one file for each game holding every unit with a skeleton", async () => {
    const { io, disk } = memory();
    const other = unit("fedtank", {
      game: { name: "Other 2", archive: "other_2", shortname: "OT" },
    });
    const result = await writeSkeletonFiles(io, ROOT, [
      unit("fedwalker"),
      unit("fedtwo"),
      unit("plain", { skeleton: undefined }),
      other,
    ]);
    expect(result.written.map((w) => [w.path, w.units])).toEqual([
      [PATH, ["fedwalker", "fedtwo"]],
      ["/data/LuaUI/Config/coilbox_skeletons/OT.json", ["fedtank"]],
    ]);
    expect(Object.keys(JSON.parse(disk.get(PATH) ?? "").units)).toEqual([
      "fedwalker",
      "fedtwo",
    ]);
  });

  it("merges into the file that is there", async () => {
    const { io, disk } = memory({
      [PATH]: JSON.stringify({
        version: 1,
        units: { seen: entry("observed", "hull") },
      }),
    });
    await writeSkeletonFiles(io, ROOT, [unit("fedwalker")]);
    expect(Object.keys(JSON.parse(disk.get(PATH) ?? "").units)).toEqual([
      "seen",
      "fedwalker",
    ]);
  });

  it("writes nothing when the file already says the same", async () => {
    const { io, writes } = memory();
    await writeSkeletonFiles(io, ROOT, [unit("fedwalker")]);
    const again = await writeSkeletonFiles(io, ROOT, [unit("fedwalker")]);
    expect(again.written).toEqual([]);
    expect(writes).toHaveLength(1);
  });

  it("leaves out a unit whose game has no short name, and says so", async () => {
    const { io, writes } = memory();
    const result = await writeSkeletonFiles(io, ROOT, [
      unit("fedwalker", {
        game: { name: "Unknown", archive: "unknown_1" },
      }),
    ]);
    expect(result.unplaced).toEqual(["fedwalker"]);
    expect(writes).toEqual([]);
  });

  it("does not write over a file it cannot read", async () => {
    const { io, writes } = memory({ [PATH]: "{ broken" });
    await expect(
      writeSkeletonFiles(io, ROOT, [unit("fedwalker")]),
    ).rejects.toThrow(/not JSON/);
    expect(writes).toEqual([]);
  });

  describe("under the short name of the game the unit will run in (issue #5193)", () => {
    const MUT = "/data/LuaUI/Config/coilbox_skeletons/MUT.json";

    it("also writes the file the mutator's short name names", async () => {
      const { io, disk } = memory();
      const result = await writeSkeletonFiles(io, ROOT, [unit("fedwalker")], {
        alsoUnder: "MUT",
      });
      expect(result.written.map((w) => [w.path, w.units])).toEqual([
        [PATH, ["fedwalker"]],
        [MUT, ["fedwalker"]],
      ]);
      expect(disk.get(MUT)).toBe(disk.get(PATH));
    });

    it("writes one file when the two short names are the same", async () => {
      const { io, writes } = memory();
      await writeSkeletonFiles(io, ROOT, [unit("fedwalker")], {
        alsoUnder: "TG",
      });
      expect(writes).toEqual([PATH]);
    });

    it("places a unit of no game under the short name it is given", async () => {
      const { io, disk } = memory();
      const result = await writeSkeletonFiles(
        io,
        ROOT,
        [unit("fedwalker", { game: null })],
        { alsoUnder: "MUT" },
      );
      expect(result.unplaced).toEqual([]);
      expect([...disk.keys()]).toEqual([MUT]);
    });

    it("ignores an empty short name", async () => {
      const { io, writes } = memory();
      await writeSkeletonFiles(io, ROOT, [unit("fedwalker")], {
        alsoUnder: "  ",
      });
      expect(writes).toEqual([PATH]);
    });
  });
});

describe("folderGameShortname", () => {
  const game = (path: string | undefined, shortname?: string) =>
    ({
      name: "G",
      primaryArchive: { name: "g", path },
      info: shortname === undefined ? {} : { shortname },
    }) as unknown as GameItem;

  it("is the short name of the scanned game that lives in the folder", () => {
    const games = [
      game("/data/games/base.sdd", "BASE"),
      game("/data/games/mutator.sdd", " MUT "),
    ];
    expect(folderGameShortname("/data/games/mutator.sdd", games)).toBe("MUT");
  });

  it("matches a folder whatever its slashes, trailing slash or case", () => {
    const games = [game("C:\\Spring\\games\\Mutator.sdd", "MUT")];
    expect(folderGameShortname("c:/spring/games/mutator.sdd/", games)).toBe(
      "MUT",
    );
  });

  it("is null for a folder no scanned game lives in, or one with no short name", () => {
    expect(folderGameShortname("/data/games/x.sdd", [])).toBeNull();
    expect(
      folderGameShortname("/data/games/x.sdd", [
        game("/data/games/x.sdd"),
        game(undefined, "NOPATH"),
      ]),
    ).toBeNull();
  });
});
