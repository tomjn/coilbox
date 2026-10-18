import { describe, expect, it } from "vitest";
import type { LuaCompatResult } from "./bindings";
import { buildReport, type CompatEntry } from "./compatReport";

/** A game with nothing wrong: Lua defs, Lua modinfo and its own widgets. */
const CLEAN = [
  "modinfo.lua",
  "units/armcom.lua",
  "objects3d/armcom.s3o",
  "LuaUI/Widgets/gui_one.lua",
];

const CATALOGUE: CompatEntry[] = [
  {
    id: "removed:Spring.MakeFont",
    kind: "removed",
    name: "Spring.MakeFont",
    since: "95.0",
  },
  {
    id: "renamed:Game.version",
    kind: "renamed",
    name: "Game.version",
    replacement: "Engine.version",
    since: "104.0",
  },
  {
    id: "signature:Game.version",
    kind: "signature",
    name: "Game.version",
    since: "104.0",
  },
  {
    id: "defTag:UnitDefs.canCapture",
    kind: "defTag",
    name: "UnitDefs.canCapture",
    since: "92.0",
  },
  {
    id: "defTag:UnitDefs.moveDef.family",
    kind: "defTag",
    name: "UnitDefs.moveDef.family",
    since: "92.0",
  },
  {
    id: "defTag:WeaponDefs.firestarter",
    kind: "defTag",
    name: "WeaponDefs.firestarter",
    since: "92.0",
  },
  {
    id: "defTag:FeatureDefs.deathFeature",
    kind: "defTag",
    name: "FeatureDefs.deathFeature",
    replacement: "FeatureDefs.deathFeatureID",
    since: "92.0",
  },
];

const lua = (over: Partial<LuaCompatResult> = {}): LuaCompatResult => ({
  files: [],
  filesScanned: 0,
  archives: ["game.sd7"],
  unresolved: [],
  errors: [],
  ...over,
});

const kinds = (files: string[], extra = {}) =>
  buildReport({ files, catalogue: CATALOGUE, ...extra }).map((f) => f.kind);

describe("buildReport", () => {
  it("finds nothing in a current game, so the page shows no section", () => {
    expect(
      buildReport({
        files: CLEAN,
        lua: lua(),
        defs: { units: { armcom: { name: "Commander" } }, weaponDefs: {} },
        catalogue: CATALOGUE,
      }),
    ).toEqual([]);
  });

  it("counts .3do models under objects3d, in any case", () => {
    const [f] = buildReport({
      files: [...CLEAN, "Objects3d/ARMCOM.3DO", "objects3d/sub/arm.3do"],
      catalogue: CATALOGUE,
    });
    expect(f).toMatchObject({ kind: "models-3do", count: 2 });
  });

  it("does not count a .3do outside objects3d", () => {
    expect(kinds([...CLEAN, "features/rock.3do"])).toEqual([]);
  });

  it("counts .fbi and .tdf unit definitions", () => {
    const [f] = buildReport({
      files: [...CLEAN, "units/ARMCOM.FBI", "units/core/corcom.tdf"],
      catalogue: CATALOGUE,
    });
    expect(f).toMatchObject({ kind: "defs-fbi", count: 2 });
  });

  it("counts each place in the Lua once, however many entries it matches", () => {
    const [f] = buildReport({
      files: CLEAN,
      catalogue: CATALOGUE,
      lua: lua({
        archives: ["game.sd7", "base.sdz"],
        files: [
          {
            archive: "game.sd7",
            path: "LuaUI/modfonts.lua",
            hits: [
              {
                entryId: "removed:Spring.MakeFont",
                line: 3,
                column: 9,
                text: "Spring.MakeFont",
              },
              {
                entryId: "renamed:Game.version",
                line: 7,
                column: 1,
                text: "Game.version",
              },
              {
                entryId: "signature:Game.version",
                line: 7,
                column: 1,
                text: "Game.version",
              },
            ],
          },
          {
            archive: "base.sdz",
            path: "LuaRules/main.lua",
            hits: [
              {
                entryId: "removed:Spring.MakeFont",
                line: 1,
                column: 1,
                text: "Spring.MakeFont",
              },
            ],
          },
        ],
      }),
    });
    expect(f.kind).toBe("lua-api");
    expect(f.count).toBe(3);
    expect(f.details).toEqual([
      {
        heading: "LuaUI/modfonts.lua",
        lines: [
          "3:9 Spring.MakeFont, removed in 95.0",
          "7:1 Game.version, renamed to Engine.version in 104.0, arguments changed in 104.0",
        ],
      },
      {
        heading: "base.sdz: LuaRules/main.lua",
        lines: ["1:1 Spring.MakeFont, removed in 95.0"],
      },
    ]);
  });

  it("lists each removed def tag with the units and weapons that set it", () => {
    const [f] = buildReport({
      files: CLEAN,
      catalogue: CATALOGUE,
      defs: {
        units: {
          armcap: { CanCapture: true },
          corcap: { cancapture: 1 },
          armcom: {
            name: "Commander",
            weapondefs: { dgun: { firestarter: 100 } },
          },
        },
        weaponDefs: { flamer: { firestarter: 50 } },
      },
    });
    expect(f).toMatchObject({ kind: "def-tags", count: 2 });
    expect(f.details).toEqual([
      {
        heading: "UnitDefs.canCapture, changed in 92.0 (2)",
        lines: ["armcap", "corcap"],
      },
      {
        heading: "WeaponDefs.firestarter, changed in 92.0 (2)",
        lines: ["armcom.dgun", "flamer"],
      },
    ]);
  });

  it("walks a nested def tag and never reports one it cannot read", () => {
    const [f] = buildReport({
      files: CLEAN,
      catalogue: CATALOGUE,
      defs: {
        units: { tank: { movedef: { family: "tank" } }, boat: { movedef: 3 } },
        weaponDefs: {},
      },
    });
    expect(f.details?.map((d) => d.heading)).toEqual([
      "UnitDefs.moveDef.family, changed in 92.0 (1)",
    ]);
  });

  it("says when there is a luaui folder but no widgets in it", () => {
    const [f] = buildReport({
      files: ["modinfo.lua", "LuaUI/main.lua"],
      catalogue: CATALOGUE,
    });
    expect(f).toMatchObject({
      kind: "no-widgets",
      label: "No luaui/widgets folder",
    });
  });

  it("says when there is no luaui folder at all", () => {
    const [f] = buildReport({ files: ["modinfo.lua"], catalogue: CATALOGUE });
    expect(f).toMatchObject({ kind: "no-widgets", label: "No luaui folder" });
  });

  it("flags modinfo.tdf only when there is no modinfo.lua", () => {
    expect(kinds([...CLEAN, "ModInfo.tdf"])).toEqual([]);
    expect(
      kinds(["modinfo.tdf", ...CLEAN.filter((f) => f !== "modinfo.lua")]),
    ).toEqual(["modinfo-tdf"]);
  });

  it("flags gamedata/messages.tdf", () => {
    expect(kinds([...CLEAN, "GameData/Messages.tdf"])).toEqual([
      "messages-tdf",
    ]);
  });

  it("names the dependencies whose Lua was not scanned", () => {
    const [f] = buildReport({
      files: CLEAN,
      catalogue: CATALOGUE,
      lua: lua({ unresolved: ["OTA Content"] }),
    });
    expect(f).toMatchObject({
      kind: "lua-unresolved",
      severity: "info",
      count: 1,
      details: [{ heading: "Not installed", lines: ["OTA Content"] }],
    });
  });

  it("reports failed reads rather than a clean result", () => {
    const [f] = buildReport({
      files: CLEAN,
      catalogue: CATALOGUE,
      errors: ["unit defs: worker exited"],
      lua: lua({ errors: ["bad archive"] }),
    });
    expect(f).toMatchObject({ kind: "read-errors", count: 2 });
    expect(f.details?.[0].lines).toEqual([
      "unit defs: worker exited",
      "bad archive",
    ]);
  });

  it("reads the shipped catalogue when none is given", () => {
    const report = buildReport({
      files: CLEAN,
      defs: { units: { cap: { cancapture: true } }, weaponDefs: {} },
    });
    expect(report.map((f) => f.kind)).toEqual(["def-tags"]);
  });
});
