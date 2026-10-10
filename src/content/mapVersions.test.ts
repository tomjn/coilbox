import { describe, expect, it } from "vitest";
import {
  countBy,
  includedVersions,
  mapVersions,
  sameMapFamily,
  sizeVerdict,
  splitMapName,
  versionsSpanned,
} from "./mapVersions";

describe("splitting a version off a map name", () => {
  it.each([
    ["Bismuth Valley v2.4.1", "Bismuth Valley", "v2.4.1"],
    ["Talus v1.0", "Talus", "v1.0"],
    ["Valles Marineris 2.6.1", "Valles Marineris", "2.6.1"],
    ["All That Glitters v2.2.3", "All That Glitters", "v2.2.3"],
    ["Center Command BAR v1.0", "Center Command BAR", "v1.0"],
    ["Greenhaven BAR v1.2", "Greenhaven BAR", "v1.2"],
    ["Isthmus v3", "Isthmus", "v3"],
    ["Tabula-v6", "Tabula", "v6"],
    ["Altair_Crossing-V3", "Altair_Crossing", "V3"],
    ["AcidicQuarry 5.17", "AcidicQuarry", "5.17"],
    ["Aetherian Void 1.7", "Aetherian Void", "1.7"],
    ["Comet Catcher Remake 1.8", "Comet Catcher Remake", "1.8"],
    ["Supreme Isthmus v2.1", "Supreme Isthmus", "v2.1"],
    ["  Talus   v1.0  ", "Talus", "v1.0"],
  ])("splits %s", (name, base, version) => {
    expect(splitMapName(name)).toEqual({ base, version });
  });

  it.each([
    "Comet Catcher Prime",
    "Comet Catcher Redux",
    "Throne 8 way",
    "DSD 2",
    "Tabula 6",
    "Spring 1944",
    "DeltaSiegeDry",
    "Map 1.0b",
    "Map 1.0-rc1",
    "Map-v1-2",
    "Map v",
    "Map 1.",
    "v2",
    "2.6.1",
    "1.0",
    "12 2.0",
  ])("leaves %s whole", (name) => {
    expect(splitMapName(name)).toEqual({ base: name.trim(), version: null });
  });

  it("only takes the last word, so a version inside a name stays", () => {
    expect(splitMapName("Mars 2.0 Remake v3")).toEqual({
      base: "Mars 2.0 Remake",
      version: "v3",
    });
    expect(splitMapName("Mars 2.0 Remake")).toEqual({
      base: "Mars 2.0 Remake",
      version: null,
    });
  });
});

describe("which names are one map", () => {
  it("groups versions of a name and the bare name", () => {
    expect(sameMapFamily("Talus v1.0", "Talus v1.1")).toBe(true);
    expect(sameMapFamily("Talus v1.0", "Talus")).toBe(true);
    expect(
      sameMapFamily("Valles Marineris 2.6.1", "Valles Marineris 2.7"),
    ).toBe(true);
  });

  it("keeps different maps apart", () => {
    expect(sameMapFamily("Comet Catcher Remake 1.8", "Comet Catcher")).toBe(
      false,
    );
    expect(sameMapFamily("Comet Catcher Redux", "Comet Catcher")).toBe(false);
    expect(sameMapFamily("Throne 8 way", "Throne 8")).toBe(false);
    expect(sameMapFamily("DSD 2", "DSD")).toBe(false);
    expect(
      sameMapFamily("Center Command BAR v1.0", "Center Command v1.0"),
    ).toBe(false);
  });
});

const matches = (...names: string[]) =>
  names.map((mapName) => ({ record: { mapName } }));

describe("the versions on a page", () => {
  it("counts each name and always lists the page's own", () => {
    expect(
      mapVersions(
        matches("Talus v1.1", "Talus v1.1", "Talus v1.10"),
        "Talus v1.0",
      ),
    ).toEqual([
      { name: "Talus v1.0", matches: 0, verdict: "same" },
      { name: "Talus v1.1", matches: 2, verdict: "unknown" },
      { name: "Talus v1.10", matches: 1, verdict: "unknown" },
    ]);
  });

  it("counts the distinct names a set of matches spans", () => {
    expect(versionsSpanned(matches("A v1", "A v1", "A v2", "A v3"))).toBe(3);
    expect(versionsSpanned(matches("A v1", "A v1"))).toBe(1);
    expect(versionsSpanned([])).toBe(0);
  });

  it("counts anything else the same way", () => {
    expect(
      countBy([{ g: "G 1.10" }, { g: "G 1.2" }, { g: "G 1.2" }], (m) => m.g),
    ).toEqual([
      { name: "G 1.2", matches: 2 },
      { name: "G 1.10", matches: 1 },
    ]);
  });
});

describe("a version of another size", () => {
  const sizes = {
    "Talus v1.0": { width: 16, height: 16 },
    "Talus v1.1": { width: 16, height: 16 },
    "Talus v2.0": { width: 24, height: 16 },
  };

  it("is told from the sizes of the installed versions", () => {
    expect(sizeVerdict("Talus v1.1", "Talus v1.0", sizes)).toBe("same");
    expect(sizeVerdict("Talus v2.0", "Talus v1.0", sizes)).toBe("different");
    expect(sizeVerdict("Talus v0.9", "Talus v1.0", sizes)).toBe("unknown");
    expect(sizeVerdict("Talus v1.1", "Talus v1.0", {})).toBe("unknown");
    expect(sizeVerdict("Talus v1.0", "Talus v1.0", {})).toBe("same");
  });

  it("is out by default, and a choice overrides the default either way", () => {
    const versions = mapVersions(
      matches("Talus v1.1", "Talus v2.0", "Talus v0.9"),
      "Talus v1.0",
      sizes,
    );
    expect([...includedVersions(versions, new Map())].sort()).toEqual([
      "Talus v0.9",
      "Talus v1.0",
      "Talus v1.1",
    ]);
    expect(
      [
        ...includedVersions(
          versions,
          new Map([
            ["Talus v2.0", true],
            ["Talus v1.1", false],
          ]),
        ),
      ].sort(),
    ).toEqual(["Talus v0.9", "Talus v1.0", "Talus v2.0"]);
  });
});
