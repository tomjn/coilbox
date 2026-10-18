import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { PlantedFeet } from "../../plantedFeet";
import { disposePlanted, placePlanted } from "./plantedLayer";

/** The lift as the position buffer holds it, in 32 bits. */
const LIFT = Math.fround(0.05);

function scene() {
  return { overlay: new THREE.Group(), planted: null as THREE.Points | null };
}

const MARKS: PlantedFeet = [
  new Map(),
  new Map<string, [number, number]>([
    ["left", [3, 2]],
    ["right", [-3, -1]],
  ]),
  new Map<string, [number, number]>([["right", [-3, -2]]]),
];

function points(state: ReturnType<typeof scene>): number[][] {
  const planted = state.planted as THREE.Points;
  const position = planted.geometry.getAttribute("position");
  const count = planted.geometry.drawRange.count;
  return Array.from({ length: count }, (_, index) => [
    position.getX(index),
    position.getY(index),
    position.getZ(index),
  ]);
}

describe("the planted foot layer", () => {
  it("draws a dot on the ground under each held foot, in the overlay", () => {
    const state = scene();
    placePlanted(state, MARKS, 1);
    expect(state.planted?.parent).toBe(state.overlay);
    expect(state.planted?.visible).toBe(true);
    expect(points(state)).toEqual([
      [3, LIFT, 2],
      [-3, LIFT, -1],
    ]);
    placePlanted(state, MARKS, 2);
    expect(points(state)).toEqual([[-3, LIFT, -2]]);
  });

  it("hides on a frame with no foot down, past the run, or with no walk", () => {
    const state = scene();
    placePlanted(state, MARKS, 1);
    placePlanted(state, MARKS, 0);
    expect(state.planted?.visible).toBe(false);
    placePlanted(state, MARKS, 1);
    placePlanted(state, MARKS, 9);
    expect(state.planted?.visible).toBe(false);
    placePlanted(state, MARKS, 1);
    placePlanted(state, null, 1);
    expect(state.planted?.visible).toBe(false);
  });

  it("is let go of with nothing left in the overlay", () => {
    const state = scene();
    placePlanted(state, MARKS, 1);
    disposePlanted(state);
    expect(state.planted).toBeNull();
    expect(state.overlay.children).toEqual([]);
  });
});
