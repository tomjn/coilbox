// @vitest-environment happy-dom

import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildEffectsLayer } from "./effectsLayer";

function particles(count: number) {
  return {
    count,
    centers: new Float32Array(Array.from({ length: count * 3 }, (_, i) => i)),
    halfSizes: new Float32Array(count).fill(3),
    colors: new Float32Array(count * 3).fill(0.5),
  };
}

describe("buildEffectsLayer", () => {
  it("draws as many dots as it is given, growing past its first size", () => {
    const layer = buildEffectsLayer();
    const geometry = layer.object.geometry as THREE.InstancedBufferGeometry;

    layer.update(particles(2));
    expect(geometry.instanceCount).toBe(2);
    expect(
      Array.from(geometry.getAttribute("center").array).slice(0, 6),
    ).toEqual([0, 1, 2, 3, 4, 5]);

    layer.update(particles(500));
    expect(geometry.instanceCount).toBe(500);
    expect(geometry.getAttribute("center").array[1499]).toBe(1499);

    layer.update(particles(0));
    expect(geometry.instanceCount).toBe(0);
    layer.dispose();
  });

  it("is never culled, since its bounds are one quad at the origin", () => {
    expect(buildEffectsLayer().object.frustumCulled).toBe(false);
  });
});
