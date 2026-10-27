import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import type { TerrainStep } from "@/blueprint/model";
import type { MapScene3D } from "@/lib/mapScene";
import { GRID_RELIEF } from "./ground";
import { drawRelief, easeRelief } from "./reliefSurface";
import { flatSource, Relief } from "./terrainRelief";

const SIDE = 65;
const FLOOR = (0 - GRID_RELIEF.min) / (GRID_RELIEF.max - GRID_RELIEF.min);

/** A scene whose ground is a displacement texture at the floor, as the editor's
 *  grid scene builds it. */
function scene() {
  const data = new Float32Array(SIDE * SIDE).fill(FLOOR);
  const texture = new THREE.DataTexture(
    data,
    SIDE,
    SIDE,
    THREE.RedFormat,
    THREE.FloatType,
  );
  const material = new THREE.MeshStandardMaterial({ displacementMap: texture });
  const render = vi.fn();
  const handle = {
    terrain: { material },
    render,
  } as unknown as MapScene3D;
  return { handle, data, render, material };
}

const wall = (height: number): TerrainStep => ({
  kind: "raise",
  shape: "wall",
  points: [
    { x: -64, z: 0 },
    { x: 64, z: 0 },
  ],
  height,
  before: 0,
});

const MID = { x: 256, z: 256 };
const relief = () => new Relief(flatSource(SIDE, SIDE));
/** The sample at a map position, in elmos, as the texture holds it. */
const heightIn = (data: Float32Array, x: number, z: number) => {
  const row = SIDE - 1 - Math.round(z / 8);
  const sample = data[row * SIDE + Math.round(x / 8)];
  return sample * (GRID_RELIEF.max - GRID_RELIEF.min) + GRID_RELIEF.min;
};

describe("drawRelief", () => {
  it("writes the raised ground into the texture the scene is given", () => {
    const { handle, data, render } = scene();
    const r = relief();
    const change = r.update([wall(60)], { at: MID, quarters: 0 }, []);
    expect(drawRelief(handle, r, change, GRID_RELIEF)).toBe(true);
    expect(heightIn(data, 256, 256)).toBeCloseTo(60, 3);
    // Far from the wall is still the floor.
    expect(heightIn(data, 16, 16)).toBeCloseTo(0, 3);
    expect(render).toHaveBeenCalled();
  });

  it("gives a trench room below the floor", () => {
    const { handle, data } = scene();
    const r = relief();
    const change = r.update([wall(-40)], { at: MID, quarters: 0 }, []);
    drawRelief(handle, r, change, GRID_RELIEF);
    expect(heightIn(data, 256, 256)).toBeCloseTo(-40, 3);
  });

  it("puts the floor back when the step goes", () => {
    const { handle, data } = scene();
    const r = relief();
    drawRelief(
      handle,
      r,
      r.update([wall(60)], { at: MID, quarters: 0 }, []),
      GRID_RELIEF,
    );
    drawRelief(
      handle,
      r,
      r.update([], { at: MID, quarters: 0 }, []),
      GRID_RELIEF,
    );
    expect(heightIn(data, 256, 256)).toBeCloseTo(0, 3);
  });

  it("lights the ground by its shape once it has any", () => {
    const { handle, material } = scene();
    const r = relief();
    drawRelief(
      handle,
      r,
      r.update([wall(60)], { at: MID, quarters: 0 }, []),
      GRID_RELIEF,
    );
    expect(material.flatShading).toBe(true);
  });

  it("eases from the ground before to the ground after", () => {
    const { handle, data } = scene();
    const r = relief();
    const change = r.update([wall(60)], { at: MID, quarters: 0 }, []);
    drawRelief(handle, r, change, GRID_RELIEF, 0);
    expect(heightIn(data, 256, 256)).toBeCloseTo(0, 3);
    drawRelief(handle, r, change, GRID_RELIEF, 0.5);
    expect(heightIn(data, 256, 256)).toBeCloseTo(30, 3);
    drawRelief(handle, r, change, GRID_RELIEF, 1);
    expect(heightIn(data, 256, 256)).toBeCloseTo(60, 3);
  });

  it("says so when the scene has no ground it can write into", () => {
    const handle = {
      terrain: undefined,
      render: vi.fn(),
    } as unknown as MapScene3D;
    const r = relief();
    const change = r.update([wall(60)], { at: MID, quarters: 0 }, []);
    expect(drawRelief(handle, r, change, GRID_RELIEF)).toBe(false);
  });
});

describe("easeRelief", () => {
  it("is left on the finished ground when it is stopped part way", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const { handle, data } = scene();
    const r = relief();
    const change = r.update([wall(60)], { at: MID, quarters: 0 }, []);
    const stop = easeRelief(handle, r, change, GRID_RELIEF, 100000);
    // Just started, so nearly all of the way back.
    expect(heightIn(data, 256, 256)).toBeLessThan(5);
    stop();
    expect(heightIn(data, 256, 256)).toBeCloseTo(60, 3);
    vi.unstubAllGlobals();
  });
});
