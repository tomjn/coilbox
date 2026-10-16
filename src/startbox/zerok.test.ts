import { describe, expect, it } from "vitest";
import {
  areasFromConfig,
  mapExtent,
  readsZerokStartBoxes,
  ZEROK_AREA_COLOR,
} from "./zerok";

describe("readsZerokStartBoxes", () => {
  it("is Zero-K by its modinfo short name", () => {
    expect(readsZerokStartBoxes({ info: { shortname: "ZK" } })).toBe(true);
    expect(readsZerokStartBoxes({ info: { shortname: " zk " } })).toBe(true);
    expect(readsZerokStartBoxes({ info: { shortname: "SF" } })).toBe(false);
    expect(readsZerokStartBoxes({ info: {} })).toBe(false);
    expect(readsZerokStartBoxes(undefined)).toBe(false);
  });
});

describe("mapExtent", () => {
  it("is the metal map's size times 16, as the minimap places markers", () => {
    expect(mapExtent({ width: 448, height: 384 })).toEqual({
      x: 7168,
      z: 6144,
    });
    expect(mapExtent({ width: 448 })).toBeNull();
    expect(mapExtent(null)).toBeNull();
  });
});

describe("areasFromConfig", () => {
  it("names each area by its short name, titled with the long one, in one colour", () => {
    const areas = areasFromConfig({
      source: "map",
      file: "mapconfig/map_startboxes.lua",
      teams: [
        {
          id: 0,
          nameLong: "West",
          nameShort: "W",
          startPoints: [[500, 1000]],
          boxes: [
            [
              [0, 0],
              [800, 0],
              [800, 6144],
            ],
          ],
        },
        { id: 1, nameLong: "East", startPoints: [], boxes: [] },
      ],
    });
    expect(areas.map((a) => [a.key, a.label, a.title])).toEqual([
      ["0", "W", "West"],
      ["1", "East", "East"],
    ]);
    expect(new Set(areas.map((a) => a.color))).toEqual(
      new Set([ZEROK_AREA_COLOR]),
    );
    expect(areas[0].points).toEqual([[500, 1000]]);
  });
});
