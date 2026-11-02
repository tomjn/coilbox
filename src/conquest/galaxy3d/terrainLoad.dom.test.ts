// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeightGrid, TerrainSpec } from "./terrain";
import { useTerrainSurround } from "./terrainLoad";

const hoisted = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock("../handmade/decode", () => ({ decodeRgba: hoisted.decode }));

const rgba = (width: number, height: number, value: number) => ({
  data: new Uint8ClampedArray(width * height * 4).fill(value),
  width,
  height,
});

const heights: HeightGrid = {
  data: new Float32Array(4).fill(0.5),
  width: 2,
  height: 2,
};

const terrain: TerrainSpec = {
  image: "map.png",
  heightmap: "height.png",
  surround: { image: "wide.png", heightmap: "wide-height.png" },
  width: 100,
  height: 100,
};

const files: Record<string, ReturnType<typeof rgba>> = {
  "map.png": rgba(2, 2, 200),
  "wide.png": rgba(4, 4, 10),
  "wide-height.png": rgba(4, 4, 51),
};

beforeEach(() => {
  hoisted.decode.mockReset();
  hoisted.decode.mockImplementation(async (url: string) => files[url]);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(cleanup);

describe("useTerrainSurround", () => {
  it("is ready at once with nothing to load for a map with no surround", () => {
    const { result } = renderHook(() =>
      useTerrainSurround({ ...terrain, surround: undefined }, heights),
    );
    expect(result.current).toEqual({ ready: true });
    expect(hoisted.decode).not.toHaveBeenCalled();
  });

  it("holds the map until the surround is read, then gives the land", async () => {
    const { result } = renderHook(() => useTerrainSurround(terrain, heights));
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.extension?.margin).toBe(1);
    expect(result.current.extension?.heights.width).toBe(4);
    expect(result.current.extension?.heights.data[0]).toBeCloseTo(0.2);
    expect(result.current.extension?.heights.data[5]).toBe(0.5);
  });

  it("draws the apron when an image cannot be read", async () => {
    hoisted.decode.mockRejectedValue(new Error("not an image"));
    const { result } = renderHook(() => useTerrainSurround(terrain, heights));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.extension).toBeUndefined();
  });

  it("draws the apron when the surround does not fit", async () => {
    hoisted.decode.mockImplementation(async (url: string) =>
      url === "map.png" ? files[url] : rgba(5, 4, 10),
    );
    const { result } = renderHook(() => useTerrainSurround(terrain, heights));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.extension).toBeUndefined();
  });
});
