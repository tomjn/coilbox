import { describe, expect, it } from "vitest";
import {
  type MapAppearanceCache,
  mergeAppearances,
  namesWithNoLocalAnswer,
  spaceMapNames,
} from "./mapAppearance";

describe("spaceMapNames", () => {
  it("returns only maps whose appearance has voidWater === true", () => {
    const set = spaceMapNames({
      "Nova Rift": { voidWater: true },
      "Green Valley": { voidWater: false },
      "Old Map": { voidWater: null },
      Unknown: {},
    });
    expect(set.has("Nova Rift")).toBe(true);
    expect(set.has("Green Valley")).toBe(false);
    expect(set.has("Old Map")).toBe(false);
    expect(set.has("Unknown")).toBe(false);
    expect(set.size).toBe(1);
  });

  it("is empty for an empty cache", () => {
    expect(spaceMapNames({}).size).toBe(0);
  });
});

describe("namesWithNoLocalAnswer", () => {
  const local = { "Isis 1.3": { voidWater: false } } as MapAppearanceCache;

  /// The rule that keeps the hub a fallback: a player with the map installed
  /// asks it nothing (issue #1739).
  it("leaves out a map this machine has already read", () => {
    expect(namesWithNoLocalAnswer(["Isis 1.3"], local)).toEqual([]);
  });

  it("asks about the names with no local answer", () => {
    expect(namesWithNoLocalAnswer(["Isis 1.3", "Tabula 3"], local)).toEqual([
      "Tabula 3",
    ]);
  });

  /// A list of what is on screen repeats, because several battles play the same
  /// map, and asking twice about one name is a wasted place in the batch.
  it("asks about a repeated name once", () => {
    expect(namesWithNoLocalAnswer(["Tabula 3", "Tabula 3"], local)).toEqual([
      "Tabula 3",
    ]);
  });

  it("ignores an empty name", () => {
    expect(namesWithNoLocalAnswer(["", "Tabula 3"], local)).toEqual([
      "Tabula 3",
    ]);
  });
});

describe("mergeAppearances", () => {
  /// The archive on this machine beats what somebody else reported about a map
  /// of the same name.
  it("lets the local answer win", () => {
    const merged = mergeAppearances(
      { "Isis 1.3": { voidWater: false } } as MapAppearanceCache,
      { "Isis 1.3": { voidWater: true } } as MapAppearanceCache,
    );
    expect(merged["Isis 1.3"].voidWater).toBe(false);
  });

  it("keeps the hub's answer for a map this machine has not got", () => {
    const merged = mergeAppearances(
      { "Isis 1.3": { voidWater: false } } as MapAppearanceCache,
      { "Tabula 3": { voidWater: true } } as MapAppearanceCache,
    );
    expect(spaceMapNames(merged)).toEqual(new Set(["Tabula 3"]));
  });

  it("is the local cache itself when the hub said nothing", () => {
    const local = { "Isis 1.3": { voidWater: true } } as MapAppearanceCache;
    expect(mergeAppearances(local, {})).toBe(local);
  });
});
