import { describe, expect, it } from "vitest";
import { MAX_NODE_MAPS, nodeMapsFrom, parseNodeMaps } from "./nodeMaps";

describe("nodeMapsFrom", () => {
  it("names the map on every node that has one", () => {
    expect(
      nodeMapsFrom([
        { id: "a", battle: { mapName: "Alpha" } },
        { id: "b", battle: { mapName: "Beta" } },
      ]),
    ).toEqual({ a: "Alpha", b: "Beta" });
  });

  it("names the map a stand-in replaced, not the stand-in", () => {
    expect(
      nodeMapsFrom([
        { id: "a", battle: { mapName: "Local", mapSubstitutedFrom: "Alpha" } },
      ]),
    ).toEqual({ a: "Alpha" });
  });

  it("skips nodes with no battle or no map", () => {
    expect(
      nodeMapsFrom([
        { id: "a" },
        { id: "b", battle: { mapName: "" } },
        { id: "c", battle: { mapName: "Gamma" } },
      ]),
    ).toEqual({ c: "Gamma" });
  });

  it("names nothing when there is nothing to name", () => {
    expect(nodeMapsFrom([{ id: "a" }])).toBeUndefined();
    expect(nodeMapsFrom([])).toBeUndefined();
  });
});

describe("parseNodeMaps", () => {
  it("reads a plain id to name record", () => {
    expect(parseNodeMaps({ a: "Alpha" })).toEqual({ a: "Alpha" });
  });

  it("ignores anything that is not a name", () => {
    expect(
      parseNodeMaps({ a: 5, b: null, c: "", "": "Alpha", d: "Delta" }),
    ).toEqual({ d: "Delta" });
  });

  it("returns nothing for a missing or wrongly shaped field", () => {
    expect(parseNodeMaps(undefined)).toBeUndefined();
    expect(parseNodeMaps("Alpha")).toBeUndefined();
    expect(parseNodeMaps(["Alpha"])).toBeUndefined();
    expect(parseNodeMaps({})).toBeUndefined();
  });

  it("caps how much a payload can carry", () => {
    const huge = Object.fromEntries(
      Array.from({ length: MAX_NODE_MAPS + 50 }, (_, i) => [`n${i}`, "Alpha"]),
    );
    expect(Object.keys(parseNodeMaps(huge) ?? {})).toHaveLength(MAX_NODE_MAPS);
  });
});
