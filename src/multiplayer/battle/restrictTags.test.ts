import { describe, expect, it } from "vitest";
import {
  diffRestrictTags,
  disabledFromTags,
  restrictTagsFor,
} from "./restrictTags";

describe("restrictTags", () => {
  it("builds sorted, indexed restrict tags with a count", () => {
    expect(restrictTagsFor(["armflash", "armcom"])).toEqual({
      "game/restrict/numrestrictions": "2",
      "game/restrict/unit0": "armcom",
      "game/restrict/limit0": "0",
      "game/restrict/unit1": "armflash",
      "game/restrict/limit1": "0",
    });
  });

  it("dedupes the disabled set", () => {
    expect(restrictTagsFor(["armcom", "armcom"])).toEqual({
      "game/restrict/numrestrictions": "1",
      "game/restrict/unit0": "armcom",
      "game/restrict/limit0": "0",
    });
  });

  it("emits no tags for an empty set", () => {
    expect(restrictTagsFor([])).toEqual({});
  });

  it("reads back the disabled set (case-insensitive, sorted, no empties)", () => {
    const tags = {
      "GAME/RESTRICT/NumRestrictions": "2",
      "GAME/RESTRICT/Unit0": "armflash",
      "game/restrict/limit0": "0",
      "game/restrict/unit1": "armcom",
      "game/restrict/limit1": "0",
      "game/restrict/unit2": "",
      "game/modoptions/maxunits": "2000",
    };
    expect(disabledFromTags(tags)).toEqual(["armcom", "armflash"]);
  });

  it("round-trips a set through tags and back", () => {
    const set = ["corak", "armcom", "armflash"];
    expect(disabledFromTags(restrictTagsFor(set))).toEqual([...set].sort());
  });

  it("diffs added/changed keys and removes now-unused indices", () => {
    // Currently two restrictions; drop to one (armcom). Index reflows so unit0
    // must change to armcom and the stale unit1/limit1 + numrestrictions clear.
    const current = {
      "game/restrict/numrestrictions": "2",
      "game/restrict/unit0": "armflash",
      "game/restrict/limit0": "0",
      "game/restrict/unit1": "armcom",
      "game/restrict/limit1": "0",
      "game/modoptions/maxunits": "2000",
    };
    const diff = diffRestrictTags(["armcom"], current);
    expect(diff.set).toEqual({
      "game/restrict/numrestrictions": "1",
      "game/restrict/unit0": "armcom",
    });
    expect(diff.remove.sort()).toEqual([
      "game/restrict/limit1",
      "game/restrict/unit1",
    ]);
  });

  it("removes every restrict tag when clearing to empty", () => {
    const current = {
      "game/restrict/numrestrictions": "1",
      "game/restrict/unit0": "armcom",
      "game/restrict/limit0": "0",
    };
    const diff = diffRestrictTags([], current);
    expect(diff.set).toEqual({});
    expect(diff.remove.sort()).toEqual([
      "game/restrict/limit0",
      "game/restrict/numrestrictions",
      "game/restrict/unit0",
    ]);
  });

  it("is a no-op diff when nothing changed", () => {
    const current = restrictTagsFor(["armcom"]);
    const diff = diffRestrictTags(["armcom"], current);
    expect(diff.set).toEqual({});
    expect(diff.remove).toEqual([]);
  });
});
