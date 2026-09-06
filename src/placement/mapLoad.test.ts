import { describe, expect, it } from "vitest";
import {
  IDLE_MAP_LOAD,
  type MapLoad,
  mapLoadFailed,
  mapLoading,
  mapLoadRows,
} from "./mapLoad";

const loading: MapLoad = {
  minimap: "done",
  heightPicture: "loading",
  exactHeights: "loading",
  skybox: "idle",
  unitDefs: "done",
  models: { state: "loading", done: 3, total: 11 },
};

describe("mapLoadRows", () => {
  it("lists every stage that was asked for, in reading order", () => {
    expect(mapLoadRows(loading).map((row) => row.key)).toEqual([
      "minimap",
      "heightPicture",
      "exactHeights",
      "unitDefs",
      "models",
    ]);
  });

  it("counts the models as they are built", () => {
    const models = mapLoadRows(loading).find((row) => row.key === "models");
    expect(models?.detail).toBe("3 / 11");
  });

  it("has no count for a pass that read nothing", () => {
    const load: MapLoad = {
      ...IDLE_MAP_LOAD,
      models: { state: "done", done: 0, total: 0 },
    };
    expect(mapLoadRows(load)[0].detail).toBeUndefined();
  });

  it("has nothing to say before anything was asked for", () => {
    expect(mapLoadRows(IDLE_MAP_LOAD)).toEqual([]);
  });
});

describe("mapLoading and mapLoadFailed", () => {
  it("is loading while any stage is", () => {
    expect(mapLoading(loading)).toBe(true);
    expect(
      mapLoading({
        ...loading,
        heightPicture: "done",
        exactHeights: "done",
        models: { state: "done", done: 11, total: 11 },
      }),
    ).toBe(false);
  });

  it("has failed once any stage has", () => {
    expect(mapLoadFailed(loading)).toBe(false);
    expect(mapLoadFailed({ ...loading, exactHeights: "failed" })).toBe(true);
    expect(
      mapLoadFailed({
        ...loading,
        models: { state: "failed", done: 0, total: 0 },
      }),
    ).toBe(true);
  });
});
