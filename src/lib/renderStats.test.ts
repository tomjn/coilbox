/**
 * The arithmetic behind the frame numbers, and which canvas they are about.
 *
 * Neither needs a GPU, and both are the parts that would make a measurement
 * quietly wrong rather than obviously broken: a percentile off by one reads as a
 * real result, and measuring a thumbnail instead of the map reads as a very fast
 * map.
 */

import type * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  counts,
  registerCanvas3D,
  summarise,
  timeRenders,
} from "./renderStats";

/** A renderer with a canvas of a given size and counts that never change. */
function fakeCanvas(width: number, height: number, calls: number) {
  let drawn = 0;
  const renderer = {
    domElement: { width, height },
    info: {
      render: { calls, triangles: calls * 100, lines: 0, points: 0, frame: 0 },
      memory: { geometries: 3, textures: 2 },
      programs: [{}, {}],
    },
  } as unknown as THREE.WebGLRenderer;
  return {
    entry: {
      renderer,
      render: () => {
        drawn++;
      },
    },
    drawn: () => drawn,
  };
}

describe("summarise", () => {
  it("takes percentiles by nearest rank", () => {
    const out = summarise([5, 1, 4, 2, 3]);
    expect(out.samples).toBe(5);
    expect(out.minMs).toBe(1);
    expect(out.maxMs).toBe(5);
    expect(out.medianMs).toBe(3);
    expect(out.p95Ms).toBe(5);
    expect(out.meanMs).toBe(3);
  });

  it("answers zero for nothing measured rather than NaN", () => {
    expect(summarise([])).toEqual({
      samples: 0,
      meanMs: 0,
      medianMs: 0,
      p95Ms: 0,
      minMs: 0,
      maxMs: 0,
    });
  });
});

describe("the canvas the numbers are about", () => {
  it("is the biggest one registered, not the last", () => {
    const thumbnail = fakeCanvas(200, 120, 4);
    const map = fakeCanvas(2844, 906, 375);
    const stopMap = registerCanvas3D(map.entry);
    const stopThumbnail = registerCanvas3D(thumbnail.entry);
    expect(counts()?.calls).toBe(375);
    expect(map.drawn()).toBe(1);
    expect(thumbnail.drawn()).toBe(0);
    stopMap();
    stopThumbnail();
  });

  it("has nothing to say once every canvas has gone", () => {
    const stop = registerCanvas3D(fakeCanvas(800, 600, 9).entry);
    stop();
    expect(counts()).toBeNull();
    expect(timeRenders()).toBeNull();
  });

  it("draws every frame of every block, plus the warm up", () => {
    const one = fakeCanvas(800, 600, 9);
    const stop = registerCanvas3D(one.entry);
    const timing = timeRenders(3, 5, 2);
    expect(timing?.samples).toBe(3);
    expect(one.drawn()).toBe(2 + 3 * 5);
    stop();
  });
});
