import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import keysFile from "@/data/engineMapInfoKeys.json";
import {
  buildMapReport,
  MAPINFO_ENTRIES_LUA,
  type MapInfoEntry,
  parseMapInfoEntries,
  type WarnedMapInfoKey,
} from "./mapCompatReport";

/** A map with nothing wrong: mapinfo.lua, an SMF and s3o features. */
const CLEAN = [
  "mapinfo.lua",
  "maps/alpha.smf",
  "maps/alpha.smt",
  "maps/detail.dds",
  "features/rock.lua",
  "objects3d/rock.s3o",
];

const WARNED: WarnedMapInfoKey[] = [
  {
    key: "atmosphere.skyDir",
    level: "deprecated",
    message: "atmosphere.skyDir in mapinfo.lua was never used",
  },
];

const kinds = (files: string[], mapinfo?: MapInfoEntry[], errors?: string[]) =>
  buildMapReport({ files, mapinfo, errors, warnedKeys: WARNED }).map(
    (f) => f.kind,
  );

describe("buildMapReport", () => {
  it("finds nothing on a clean map", () => {
    expect(
      kinds(CLEAN, [{ path: "resources.detailtex", value: "detail.dds" }]),
    ).toEqual([]);
  });

  it("reports an SM3 map, and does not also call it a map with no settings", () => {
    const report = buildMapReport({
      files: ["Maps/Old.sm3", "maps/old.sm3.png"],
    });
    expect(report.map((f) => f.kind)).toEqual(["sm3"]);
    expect(report[0].severity).toBe("problem");
    expect(report[0].details?.[0].lines).toEqual(["maps/old.sm3"]);
  });

  it("reports a map with neither mapinfo.lua nor an .smd", () => {
    expect(kinds(["maps/alpha.smf", "maps/alpha.smt"])).toEqual([
      "no-map-settings",
    ]);
  });

  it("shows an .smd-only map as information", () => {
    const report = buildMapReport({
      files: ["maps/alpha.smf", "maps/alpha.smd"],
    });
    expect(report.map((f) => [f.kind, f.severity])).toEqual([
      ["smd-only", "info"],
    ]);
  });

  it("does not call a map with both mapinfo.lua and an .smd .smd-only", () => {
    expect(kinds([...CLEAN, "maps/alpha.smd"])).toEqual([]);
  });

  it("counts .3do feature models under objects3d and features", () => {
    const report = buildMapReport({
      files: [
        ...CLEAN,
        "objects3d/tree.3do",
        "Objects3d\\Rock2.3DO",
        "features/all worlds/crate.3do",
        "unittextures/tree.3do",
      ],
    });
    expect(report.map((f) => f.kind)).toEqual(["features-3do"]);
    expect(report[0].count).toBe(3);
  });

  it("reports .pcx textures as a problem and .bmp textures as information", () => {
    const report = buildMapReport({
      files: CLEAN,
      mapinfo: [
        { path: "resources", value: undefined },
        { path: "resources.detailtex", value: "maps/detail.BMP" },
        { path: "resources.specularTex", value: "spec.dds" },
        { path: "smf.minimaptex", value: "mini.pcx" },
        { path: "water.texture", value: "water.bmp" },
        { path: "description", value: "Not a bmp" },
      ],
      warnedKeys: WARNED,
    });
    expect(report.map((f) => [f.kind, f.severity, f.count])).toEqual([
      ["textures-pcx", "problem", 1],
      ["textures-bmp", "info", 2],
    ]);
    expect(report[0].details?.[0].lines).toEqual(["smf.minimaptex = mini.pcx"]);
    expect(report[1].details?.[0].lines).toEqual([
      "resources.detailtex = maps/detail.BMP",
      "water.texture = water.bmp",
    ]);
  });

  it("reports a key the engine warns on, matched without regard to case", () => {
    const report = buildMapReport({
      files: CLEAN,
      mapinfo: [{ path: "atmosphere" }, { path: "atmosphere.skydir" }],
      warnedKeys: WARNED,
    });
    expect(report.map((f) => f.kind)).toEqual(["mapinfo-keys"]);
    expect(report[0].details).toEqual([
      { heading: "atmosphere.skyDir", lines: [WARNED[0].message] },
    ]);
  });

  it("uses the shipped key list by default", () => {
    const shipped = keysFile.warned[0];
    const report = buildMapReport({
      files: CLEAN,
      mapinfo: [{ path: shipped.key.toLowerCase() }],
    });
    expect(report.map((f) => f.kind)).toEqual(["mapinfo-keys"]);
  });

  it("lists failed reads as information, last", () => {
    expect(kinds(["maps/a.smf"], undefined, ["mapinfo.lua: boom"])).toEqual([
      "no-map-settings",
      "read-errors",
    ]);
  });
});

describe("parseMapInfoEntries", () => {
  it("reads paths with and without values, quoted or not", () => {
    const want = [
      { path: "atmosphere" },
      { path: "atmosphere.skydir" },
      { path: "resources.detailtex", value: "a=b.bmp" },
    ];
    const line = "atmosphere;atmosphere.skydir;resources.detailtex=a=b.bmp";
    expect(parseMapInfoEntries(line)).toEqual(want);
    expect(parseMapInfoEntries(`"${line}"`)).toEqual(want);
    expect(parseMapInfoEntries(undefined)).toEqual([]);
    expect(parseMapInfoEntries('""')).toEqual([]);
  });
});

describe("MAPINFO_ENTRIES_LUA", () => {
  const VFS_STAND_IN = `
VFS = {}
VFS.Include = function(path)
  if path ~= 'mapinfo.lua' then error('no ' .. path) end
  local t = {
    name = 'Alpha',
    Atmosphere = { skyDir = { 1, 0, 0 }, minWind = 5 },
    resources = { detailTex = 'maps\\\\Detail.bmp', ['bad;key'] = 'x', quote = 'a"b' },
    custom = {},
  }
  t.custom.loop = t
  return t
end
`;

  it("flattens the table with lowercased keys", () => {
    const run = spawnSync(
      "luajit",
      [
        "-e",
        "local src = io.read('*a'); local f, err = loadstring(src); " +
          "if not f then io.stderr:write(err); os.exit(1) end io.write(f())",
      ],
      {
        input: `${VFS_STAND_IN}\nreturn (function()\n${MAPINFO_ENTRIES_LUA}\nend)()`,
      },
    );
    expect(run.stderr?.toString() ?? "").toBe("");
    expect(parseMapInfoEntries(run.stdout.toString())).toEqual([
      { path: "atmosphere" },
      { path: "atmosphere.minwind" },
      { path: "atmosphere.skydir" },
      { path: "atmosphere.skydir.1" },
      { path: "atmosphere.skydir.2" },
      { path: "atmosphere.skydir.3" },
      { path: "custom" },
      { path: "custom.loop" },
      { path: "name", value: "Alpha" },
      { path: "resources" },
      { path: "resources.detailtex", value: "maps/Detail.bmp" },
      { path: "resources.quote" },
    ]);
  });
});
