import { describe, expect, it } from "vitest";
import type { UnitBuildpicsResult } from "@/content/bindings";
import type { UnitClones } from "./clones";
import { unitPicLookup } from "./unitPics";

const PICS: UnitBuildpicsResult = {
  units: {
    armaap: { iconFile: "armaap.png" },
    armcom: { iconSkipped: "no-source" },
  },
  errors: [],
};

const GAME_UNITS = {
  armaap: { buildpic: "ARMAAP.DDS" },
  armcom: {},
};

/** A copy of `armaap`, as `deriveClone` makes one: the whole definition. */
const clone = (
  key: string,
  source: string | undefined,
  def: Record<string, unknown>,
): UnitClones => ({
  [key]: { key, source, replacesGameUnit: false, def },
});

const look = (
  clones: UnitClones = {},
  extra: Record<string, Record<string, unknown>> = {},
  overrides: Record<string, Record<string, unknown>> = {},
) =>
  unitPicLookup({
    buildpics: PICS,
    clones,
    units: { ...GAME_UNITS, ...extra },
    overrides,
  });

describe("unitPicLookup", () => {
  it("gives a game unit whatever unitsync resolved for it", () => {
    expect(look()("armaap")).toEqual({ iconFile: "armaap.png" });
  });

  it("passes on why a unit has no picture rather than dropping the entry", () => {
    expect(look()("armcom")).toEqual({ iconSkipped: "no-source" });
  });

  it("says nothing about a unit the read has not answered for", () => {
    expect(look()("armflea")).toBeUndefined();
  });

  it("says nothing while the read is still out", () => {
    const pending = unitPicLookup({
      buildpics: null,
      clones: {},
      units: GAME_UNITS,
      overrides: {},
    });
    expect(pending("armaap")).toBeUndefined();
  });

  /** A copy is in no archive, so unitsync has never heard of it, but it carries
   *  its source's `buildpic` and will draw that picture in the game. */
  it("gives a copy the picture of the unit it was copied from", () => {
    const clones = clone("myaap", "armaap", { buildpic: "ARMAAP.DDS" });
    expect(look(clones, { myaap: clones.myaap.def })("myaap")).toEqual({
      iconFile: "armaap.png",
    });
  });

  it("matches the two whatever case the game wrote the file name in", () => {
    const clones = clone("myaap", "armaap", { buildpic: "armaap.dds" });
    expect(look(clones, { myaap: clones.myaap.def })("myaap")).toEqual({
      iconFile: "armaap.png",
    });
  });

  /** The engine would look for `unitpics/myaap.dds`, which the game does not
   *  ship, so the copy draws nothing there and nothing here. */
  it("gives a copy of a unit that declares no picture no picture either", () => {
    const clones = clone("mycom", "armcom", {});
    expect(look(clones, { mycom: clones.mycom.def })("mycom")).toBeUndefined();
  });

  it("stops borrowing once the copy's own buildpic is changed", () => {
    const clones = clone("myaap", "armaap", { buildpic: "ARMAAP.DDS" });
    const overrides = { myaap: { buildpic: "unitpics/mine.dds" } };
    expect(
      look(clones, { myaap: clones.myaap.def }, overrides)("myaap"),
    ).toBeUndefined();
  });

  /** A unit out of the lego builder was copied from nothing, and its files are
   *  in the game folder, so the game's own read is the whole answer. */
  it("leaves a built unit to the game's own read", () => {
    const clones = clone("armaap", undefined, { buildpic: "OTHER.DDS" });
    expect(look(clones)("armaap")).toEqual({ iconFile: "armaap.png" });
  });
});
