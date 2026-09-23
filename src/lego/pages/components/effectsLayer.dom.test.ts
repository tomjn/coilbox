// @vitest-environment happy-dom

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { buildEffectsLayer } from "./effectsLayer";

function particles(count: number) {
  return {
    count,
    centers: new Float32Array(Array.from({ length: count * 3 }, (_, i) => i)),
    halfSizes: new Float32Array(count).fill(3),
    colors: new Float32Array(count * 3).fill(0.5),
  };
}

function geometryOf(
  layer: ReturnType<typeof buildEffectsLayer>,
): THREE.InstancedBufferGeometry {
  return layer.object.geometry as THREE.InstancedBufferGeometry;
}

describe("buildEffectsLayer", () => {
  it("draws as many dots as it is given, growing past its first size", () => {
    const layer = buildEffectsLayer();

    layer.update(particles(2));
    expect(geometryOf(layer).instanceCount).toBe(2);
    expect(
      Array.from(geometryOf(layer).getAttribute("center").array).slice(0, 6),
    ).toEqual([0, 1, 2, 3, 4, 5]);

    // Past the first geometry's capacity, three.js's cached instance count
    // means growing needs a whole new geometry, which `update` swaps in.
    layer.update(particles(500));
    expect(geometryOf(layer).instanceCount).toBe(500);
    expect(geometryOf(layer).getAttribute("center").array[1499]).toBe(1499);

    layer.update(particles(0));
    expect(geometryOf(layer).instanceCount).toBe(0);
    layer.dispose();
  });

  it("disposes the old instanced attributes when it grows past its capacity", () => {
    const layer = buildEffectsLayer();
    layer.update(particles(2));
    const oldGeometry = geometryOf(layer);
    const disposeSpy = vi.spyOn(oldGeometry, "dispose");

    layer.update(particles(500));

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(geometryOf(layer)).not.toBe(oldGeometry);
    layer.dispose();
  });

  it("is never culled, since its bounds are one quad at the origin", () => {
    expect(buildEffectsLayer().object.frustumCulled).toBe(false);
  });

  it("draws over everything, so a spray inside the stand-in still shows", () => {
    const { object } = buildEffectsLayer();
    expect((object.material as THREE.ShaderMaterial).depthTest).toBe(false);
    expect(object.renderOrder).toBeGreaterThan(0);
  });

  it("carries a viewport and a pixel ratio uniform, filled from the renderer before it draws", () => {
    const layer = buildEffectsLayer();
    const material = layer.object.material as THREE.ShaderMaterial;
    expect(material.uniforms.viewport.value).toBeInstanceOf(THREE.Vector2);
    expect(material.uniforms.pixelRatio.value).toBe(1);

    const renderer = {
      getDrawingBufferSize: (out: THREE.Vector2) => out.set(800, 600),
      getPixelRatio: () => 2,
    } as unknown as THREE.WebGLRenderer;
    layer.object.onBeforeRender?.(
      renderer,
      new THREE.Scene(),
      new THREE.Camera(),
      geometryOf(layer),
      material,
      new THREE.Group(),
    );

    expect(material.uniforms.viewport.value.toArray()).toEqual([800, 600]);
    expect(material.uniforms.pixelRatio.value).toBe(2);
    layer.dispose();
  });
});
