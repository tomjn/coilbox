// @vitest-environment happy-dom

/**
 * Measure lines in the scene (issue #4524): an end on a piece follows the
 * piece, one whose piece is deleted stays where it was last drawn, and each
 * line carries its length at its middle in the readout's words.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { lineLabel, type Measurement } from "../../measure";
import type { LoadedPack } from "../../pack";
import {
  drawMeasurements,
  layoutMeasurements,
  locateEnd,
  locateLines,
  newMeasureScene,
  placeEnd,
} from "./measureLayer";
import type { SceneState } from "./sceneState";

/** A unit root holding one piece, `wheel`, at x 10. */
function scene() {
  const root = new THREE.Group();
  const wheel = new THREE.Group();
  wheel.position.set(10, 0, 0);
  root.add(wheel);
  const groups = new Map([["wheel", wheel]]);
  return { root, wheel, groups, measure: newMeasureScene() };
}

describe("an end placed on a piece", () => {
  it("is held in the piece's own space", () => {
    const { groups } = scene();
    const end = placeEnd({ groups }, [11, 0, 0], "wheel");
    expect(end.on?.pieceId).toBe("wheel");
    expect(end.on?.local[0]).toBeCloseTo(1);
    expect(end.at).toEqual([11, 0, 0]);
  });

  it("follows the piece when it moves", () => {
    const state = scene();
    const end = placeEnd(state, [11, 0, 0], "wheel");
    state.wheel.position.set(20, 3, 0);
    const [x, y, z] = locateEnd(state, end, "m:from");
    expect(x).toBeCloseTo(21);
    expect(y).toBeCloseTo(3);
    expect(z).toBeCloseTo(0);
  });

  it("turns with the piece when it rotates", () => {
    const state = scene();
    const end = placeEnd(state, [11, 0, 0], "wheel");
    state.wheel.rotation.set(0, Math.PI / 2, 0);
    const [x, y, z] = locateEnd(state, end, "m:from");
    expect(x).toBeCloseTo(10);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(-1);
  });

  it("follows a parent that moves the piece", () => {
    const state = scene();
    const end = placeEnd(state, [11, 0, 0], "wheel");
    state.root.position.set(0, 0, 5);
    expect(locateEnd(state, end, "m:from")[2]).toBeCloseTo(5);
  });

  it("stays at its last world position once the piece is deleted", () => {
    const state = scene();
    const end = placeEnd(state, [11, 0, 0], "wheel");
    state.wheel.position.set(30, 0, 0);
    expect(locateEnd(state, end, "m:from")[0]).toBeCloseTo(31);
    state.groups.delete("wheel");
    state.wheel.removeFromParent();
    const [x, y, z] = locateEnd(state, end, "m:from");
    expect(x).toBeCloseTo(31);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(0);
  });
});

describe("an end on the ground or a guide", () => {
  it("is a world point that no piece moves", () => {
    const state = scene();
    const end = placeEnd(state, [1, 0, 2], null);
    expect(end.on).toBeNull();
    state.root.position.set(5, 5, 5);
    expect(locateEnd(state, end, "m:to")).toEqual([1, 0, 2]);
  });

  it("is a world point when the piece it names is not in the scene", () => {
    expect(placeEnd(scene(), [1, 0, 2], "gone").on).toBeNull();
  });
});

describe("a line between a piece and the ground", () => {
  it("is measured from where the piece is now", () => {
    const state = scene();
    const m: Measurement = {
      id: "m",
      from: placeEnd(state, [10, 0, 0], "wheel"),
      to: placeEnd(state, [0, 0, 0], null),
    };
    state.measure.measurements = [m];
    state.wheel.position.set(3, 4, 0);
    const [line] = locateLines(state).lines;
    expect(line.from).toEqual([3, 4, 0]);
    expect(line.to).toEqual([0, 0, 0]);
  });
});

describe("the label on a line", () => {
  function drawn() {
    const base = scene();
    const state = {
      ...base,
      scene: new THREE.Scene(),
      renderer: { getPixelRatio: () => 1 },
      packRef: { current: { manifest: { unit: 0.25 } } as LoadedPack },
      render: () => layoutMeasurements(state),
    } as unknown as SceneState & typeof base;
    return state;
  }
  const labels = (state: SceneState) =>
    (state.measure.layer?.children ?? []).filter(
      (c): c is THREE.Sprite => c instanceof THREE.Sprite,
    );

  it("gives the length in the readout's words, at the line's middle", () => {
    const state = drawn();
    const told: unknown[] = [];
    state.measure.onLines = (lines) => told.push(lines);
    drawMeasurements(
      state,
      [
        {
          id: "m",
          from: placeEnd(state, [0, 0, 0], null),
          to: placeEnd(state, [3, 4, 0], null),
        },
      ],
      null,
    );
    const [tag] = labels(state);
    expect(tag.userData.text).toBe(lineLabel([0, 0, 0], [3, 4, 0], 0.25));
    expect(tag.userData.text).toBe("5 elmos, 20 steps");
    expect(tag.position.toArray()).toEqual([1.5, 2, 0]);
    expect(told).toHaveLength(1);
  });

  it("changes as the piece under one end moves, and the readout hears of it", () => {
    const state = drawn();
    const told: unknown[] = [];
    state.measure.onLines = (lines) => told.push(lines);
    drawMeasurements(
      state,
      [
        {
          id: "m",
          from: placeEnd(state, [10, 0, 0], "wheel"),
          to: placeEnd(state, [0, 0, 0], null),
        },
      ],
      null,
    );
    expect(labels(state)[0].userData.text).toBe("10 elmos, 40 steps");
    state.wheel.position.set(2, 0, 0);
    state.render();
    expect(labels(state)).toHaveLength(1);
    expect(labels(state)[0].userData.text).toBe("2 elmos, 8 steps");
    expect(told).toHaveLength(2);
    // Nothing moved, so the readout is not told again.
    state.render();
    expect(told).toHaveLength(2);
  });
});
