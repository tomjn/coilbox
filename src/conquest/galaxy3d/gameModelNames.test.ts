import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/content/bindings", () => ({
  unitsyncLuaExec: vi.fn(),
}));

import { unitsyncLuaExec } from "@/content/bindings";
import {
  FEATURE_OBJECTS_LUA,
  type GameModelLookups,
  loadFeatureObjects,
  parseFeatureObjects,
  resolveGameModels,
} from "./gameModelNames";

/**
 * A faked game. `files` is what the model reader finds by the name it is
 * given, `units` and `features` are the definition lists, keyed lowercased
 * the way the real ones are.
 */
function game(
  files: string[],
  units: Record<string, string> = {},
  features: Record<string, string> = {},
) {
  const reads: string[][] = [];
  const lists = { units: 0, features: 0 };
  const lookups: GameModelLookups<string> = {
    async read(objects) {
      reads.push(objects);
      return new Map(
        objects.map((o) => [o, files.includes(o) ? `model:${o}` : null]),
      );
    },
    async unitObjects() {
      lists.units++;
      return new Map(Object.entries(units));
    },
    async featureObjects() {
      lists.features++;
      return new Map(Object.entries(features));
    },
  };
  return { lookups, reads, lists };
}

describe("resolveGameModels", () => {
  it("keeps every name the model reader takes, without fetching any list", async () => {
    const g = game(["objects3d/features/pinetree.s3o", "armcom", "rock.s3o"]);
    const got = await resolveGameModels(
      ["objects3d/features/pinetree.s3o", "armcom", "rock.s3o"],
      g.lookups,
    );
    expect(got.get("objects3d/features/pinetree.s3o")).toBe(
      "model:objects3d/features/pinetree.s3o",
    );
    expect(got.get("armcom")).toBe("model:armcom");
    expect(got.get("rock.s3o")).toBe("model:rock.s3o");
    expect(g.reads).toHaveLength(1);
    expect(g.lists).toEqual({ units: 0, features: 0 });
  });

  it("draws a unit by the model its objectname names", async () => {
    const g = game(["light_bot"], { scout: "light_bot" });
    const got = await resolveGameModels(["scout"], g.lookups);
    expect(got.get("scout")).toBe("model:light_bot");
  });

  it("matches a unit name whatever its case", async () => {
    const g = game(["light_bot"], { scout: "light_bot" });
    const got = await resolveGameModels(["Scout"], g.lookups);
    expect(got.get("Scout")).toBe("model:light_bot");
  });

  it("draws a feature by the model its object names", async () => {
    const g = game(["trees/pine_a.s3o"], {}, { pinetree1: "trees/pine_a.s3o" });
    const got = await resolveGameModels(["pinetree1"], g.lookups);
    expect(got.get("pinetree1")).toBe("model:trees/pine_a.s3o");
  });

  it("draws the model file when a name is also a unit", async () => {
    // A unit called armcom whose objectname names another file.
    const g = game(["armcom", "commander_b"], { armcom: "commander_b" });
    const got = await resolveGameModels(["armcom"], g.lookups);
    expect(got.get("armcom")).toBe("model:armcom");
    expect(g.lists).toEqual({ units: 0, features: 0 });
  });

  it("takes the unit before the feature when both use the name", async () => {
    const g = game(
      ["unit_model", "feature_model"],
      { wreck: "unit_model" },
      {
        wreck: "feature_model",
      },
    );
    const got = await resolveGameModels(["wreck"], g.lookups);
    expect(got.get("wreck")).toBe("model:unit_model");
  });

  it("falls through to the feature when the unit's model does not read", async () => {
    const g = game(
      ["feature_model"],
      { wreck: "gone" },
      {
        wreck: "feature_model",
      },
    );
    const got = await resolveGameModels(["wreck"], g.lookups);
    expect(got.get("wreck")).toBe("model:feature_model");
  });

  it("answers null for a name that is nothing, and still draws the rest", async () => {
    const g = game(["light_bot", "armcom"], { scout: "light_bot" });
    const got = await resolveGameModels(
      ["armcom", "scout", "nothing"],
      g.lookups,
    );
    expect(got.get("armcom")).toBe("model:armcom");
    expect(got.get("scout")).toBe("model:light_bot");
    expect(got.get("nothing")).toBeNull();
  });

  it("fetches each list once and reads a shared model once, however many names", async () => {
    const g = game(
      ["trees/pine_a.s3o", "light_bot"],
      { scout: "light_bot" },
      { pinetree1: "trees/pine_a.s3o", pinetree2: "trees/pine_a.s3o" },
    );
    const got = await resolveGameModels(
      ["pinetree1", "pinetree2", "scout", "nothing"],
      g.lookups,
    );
    expect(got.get("pinetree1")).toBe("model:trees/pine_a.s3o");
    expect(got.get("pinetree2")).toBe("model:trees/pine_a.s3o");
    expect(g.lists).toEqual({ units: 1, features: 1 });
    expect(g.reads).toHaveLength(2);
    expect([...g.reads[1]].sort()).toEqual(["light_bot", "trees/pine_a.s3o"]);
  });

  it("does not read again a definition that names what the author wrote", async () => {
    const g = game([], { armcom: "ARMCOM" });
    const got = await resolveGameModels(["armcom"], g.lookups);
    expect(got.get("armcom")).toBeNull();
    expect(g.reads).toHaveLength(1);
  });

  it("counts a list that fails as empty and says why once", async () => {
    const g = game(["trees/pine_a.s3o"], {}, { pinetree1: "trees/pine_a.s3o" });
    g.lookups.unitObjects = () => Promise.reject(new Error("defs.lua broke"));
    const warn = vi.fn();
    const got = await resolveGameModels(
      ["pinetree1", "scout"],
      g.lookups,
      warn,
    );
    expect(got.get("pinetree1")).toBe("model:trees/pine_a.s3o");
    expect(got.get("scout")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("defs.lua broke");
  });

  it("keeps what it already read when reading the definitions' models fails", async () => {
    const g = game(["armcom"], { scout: "light_bot" });
    const read = g.lookups.read;
    let calls = 0;
    g.lookups.read = (objects) =>
      ++calls === 1 ? read(objects) : Promise.reject(new Error("timed out"));
    const warn = vi.fn();
    const got = await resolveGameModels(["armcom", "scout"], g.lookups, warn);
    expect(got.get("armcom")).toBe("model:armcom");
    expect(got.get("scout")).toBeNull();
    expect(warn.mock.calls[0][0]).toContain("timed out");
  });
});

describe("parseFeatureObjects", () => {
  it("reads the quoted line the parser hands back", () => {
    const got = parseFeatureObjects(
      '"pinetree1=trees/pine_a.s3o;rock=Rock.S3O"',
    );
    expect(got).toEqual(
      new Map([
        ["pinetree1", "trees/pine_a.s3o"],
        ["rock", "Rock.S3O"],
      ]),
    );
  });

  it("skips entries that do not read as name=object", () => {
    const got = parseFeatureObjects('"=x;nothing;tree=;ok=ok.s3o"');
    expect(got).toEqual(new Map([["ok", "ok.s3o"]]));
  });

  it("reads nothing from an empty or absent result", () => {
    expect(parseFeatureObjects('""').size).toBe(0);
    expect(parseFeatureObjects(undefined).size).toBe(0);
  });
});

describe("loadFeatureObjects", () => {
  it("runs the feature Lua against the game archive", async () => {
    vi.mocked(unitsyncLuaExec).mockResolvedValueOnce({
      result: '"pinetree1=trees/pine_a.s3o"',
      errors: [],
    });
    const got = await loadFeatureObjects(
      { enginePath: "/e", dataDir: "/d" },
      "game.sdz",
    );
    expect(unitsyncLuaExec).toHaveBeenCalledWith({
      enginePath: "/e",
      dataDir: "/d",
      archive: "game.sdz",
      source: FEATURE_OBJECTS_LUA,
    });
    expect(got.get("pinetree1")).toBe("trees/pine_a.s3o");
  });

  it("rejects with the parser's error", async () => {
    vi.mocked(unitsyncLuaExec).mockResolvedValueOnce({
      error: "featuredefs.lua: boom",
      errors: [],
    });
    await expect(
      loadFeatureObjects({ enginePath: "/e", dataDir: "/d" }, "game.sdz"),
    ).rejects.toThrow("boom");
  });
});

describe("FEATURE_OBJECTS_LUA", () => {
  /**
   * Run under luajit with a stand-in VFS whose `featuredefs.lua` fails on
   * `DEFS` whenever it can see the post step, the way 6 of 8 real games did.
   */
  const VFS_STAND_IN = `
local files = { ['gamedata/featuredefs.lua'] = true, ['gamedata/featuredefs_post.lua'] = true }
VFS = {}
VFS.FileExists = function(path) return files[path] == true end
VFS.Include = function(path)
  if VFS.FileExists('gamedata/featuredefs_post.lua') then error('attempt to index global DEFS') end
  return {
    PineTree1 = { object = 'trees/pine_a.s3o' },
    rock = { Object = 'Rock.S3O' },
    noobject = { footprintx = 2 },
    badname = { object = 'a;b.s3o' },
  }
end
`;

  it("lists the features with the post step hidden, and puts VFS back", () => {
    const run = spawnSync(
      "luajit",
      [
        "-e",
        "local src = io.read('*a'); local f, err = loadstring(src); " +
          "if not f then io.stderr:write(err); os.exit(1) end " +
          "local out = f(); io.write(out, '|', tostring(VFS.FileExists('gamedata/featuredefs_post.lua')))",
      ],
      {
        input: `${VFS_STAND_IN}\nreturn (function()\n${FEATURE_OBJECTS_LUA}\nend)()`,
      },
    );
    expect(run.stderr?.toString() ?? "").toBe("");
    expect(run.stdout.toString()).toBe(
      "pinetree1=trees/pine_a.s3o;rock=Rock.S3O|true",
    );
  });
});
