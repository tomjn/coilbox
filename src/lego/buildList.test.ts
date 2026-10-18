import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "@/content/bindings";
import {
  buildListEntries,
  buildListTdf,
  readsBuildList,
  withBuiltUnits,
} from "./buildList";

// Issue #4515.
describe("buildListEntries", () => {
  const game = { fedlandfac: {}, fedengineer: {} };

  it("keeps each builder the game has, once", () => {
    const { entries, leftOut } = buildListEntries(
      [
        {
          unitName: "skyfort",
          builtBy: ["fedlandfac", "fedengineer", "fedlandfac"],
        },
      ],
      "Splinter Faction",
      game,
    );
    expect(entries).toEqual([
      { unitName: "skyfort", builtBy: ["fedlandfac", "fedengineer"] },
    ]);
    expect(leftOut).toEqual([]);
  });

  it("leaves out a builder the game does not have, and says so", () => {
    const { entries, leftOut } = buildListEntries(
      [{ unitName: "skyfort", builtBy: ["armlab", "fedlandfac"] }],
      "Splinter Faction",
      game,
    );
    expect(entries).toEqual([{ unitName: "skyfort", builtBy: ["fedlandfac"] }]);
    expect(leftOut).toEqual([
      "armlab is not in Splinter Faction, so it does not build skyfort.",
    ]);
  });

  it("keeps every builder while the game's units are not read", () => {
    const { entries } = buildListEntries(
      [{ unitName: "skyfort", builtBy: ["armlab"] }],
      "Splinter Faction",
      null,
    );
    expect(entries).toEqual([{ unitName: "skyfort", builtBy: ["armlab"] }]);
  });

  it("refuses a name that would break the file", () => {
    const { entries, leftOut } = buildListEntries(
      [
        { unitName: "skyfort", builtBy: ["fed;}"] },
        { unitName: "Sky Fort", builtBy: ["fedlandfac"] },
      ],
      "Splinter Faction",
      null,
    );
    expect(entries).toEqual([]);
    expect(leftOut).toEqual([
      "fed;} cannot build skyfort.",
      "Sky Fort cannot go on a build list.",
    ]);
  });

  it("skips a unit that names no builder", () => {
    expect(
      buildListEntries(
        [{ unitName: "skyfort", builtBy: [] }],
        "Splinter Faction",
        game,
      ),
    ).toEqual({ entries: [], leftOut: [] });
  });
});

describe("buildListTdf", () => {
  it("writes one menu entry per builder and unit, numbered from one", () => {
    const tdf = buildListTdf([
      { unitName: "skyfort", builtBy: ["fedlandfac", "fedengineer"] },
      { unitName: "mole", builtBy: ["fedengineer"] },
    ]);
    expect(tdf).toContain(
      "[MENUENTRY1]\n{\n\tunitmenu=fedlandfac;\n\tunitname=skyfort;\n}",
    );
    expect(tdf).toContain(
      "[MENUENTRY2]\n{\n\tunitmenu=fedengineer;\n\tunitname=skyfort;\n}",
    );
    expect(tdf).toContain(
      "[MENUENTRY3]\n{\n\tunitmenu=fedengineer;\n\tunitname=mole;\n}",
    );
    expect(tdf).not.toContain("MENUENTRY4");
  });
});

describe("readsBuildList", () => {
  it("reads the parser's quoted answer", () => {
    expect(readsBuildList('"yes"')).toBe(true);
    expect(readsBuildList('"no"')).toBe(false);
    expect(readsBuildList(undefined)).toBe(false);
  });
});

describe("withBuiltUnits", () => {
  const units: UnitDatasetEntry[] = [
    { name: "fedcommander", buildOptions: ["fedlandfac"] },
    { name: "fedlandfac", buildOptions: ["fedbear"] },
    { name: "fedbear", buildOptions: [] },
  ];

  it("adds the unit, and to the end of each builder's options", () => {
    const out = withBuiltUnits(units, [
      { unitName: "skyfort", builtBy: ["fedlandfac"], fullName: "Sky Fort" },
    ]);
    expect(out.find((u) => u.name === "fedlandfac")?.buildOptions).toEqual([
      "fedbear",
      "skyfort",
    ]);
    expect(out.find((u) => u.name === "skyfort")).toEqual({
      name: "skyfort",
      fullName: "Sky Fort",
      buildOptions: [],
    });
    expect(units[1]?.buildOptions).toEqual(["fedbear"]);
  });
});
