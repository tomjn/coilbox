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
    sprites: {
      count: 0,
      centers: new Float32Array(),
      halfSizes: new Float32Array(),
      colors: new Float32Array(),
      bitmaps: new Float32Array(),
      axes: new Float32Array(),
      sides: new Float32Array(),
      halfLengths: new Float32Array(),
      uvRanges: new Float32Array(),
    },
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

function withSprites(
  count: number,
  bitmap: number,
  axis: [number, number, number] = [0, 0, 0],
  halfLength = 0,
  side: [number, number, number] = [0, 0, 0],
) {
  const axes = new Float32Array(count * 3);
  const sides = new Float32Array(count * 3);
  const halfLengths = new Float32Array(count).fill(halfLength);
  const uvRanges = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    axes.set(axis, i * 3);
    sides.set(side, i * 3);
    uvRanges.set([0, 1], i * 2);
  }
  return {
    ...particles(0),
    sprites: {
      count,
      centers: new Float32Array(count * 3),
      halfSizes: new Float32Array(count).fill(2),
      colors: new Float32Array(count * 4).fill(1),
      bitmaps: new Float32Array(count).fill(bitmap),
      axes,
      sides,
      halfLengths,
      uvRanges,
    },
  };
}

function spriteGeometry(layer: ReturnType<typeof buildEffectsLayer>) {
  return layer.sprites.geometry as THREE.InstancedBufferGeometry;
}

describe("the sprite mesh", () => {
  it("hangs off the dots, so the effects toggle hides both", () => {
    const layer = buildEffectsLayer();
    expect(layer.sprites.parent).toBe(layer.object);
    expect(layer.sprites.frustumCulled).toBe(false);
    layer.dispose();
  });

  it("blends as the engine blends particles, with the depth test on and depth writes off", () => {
    const material = buildEffectsLayer().sprites
      .material as THREE.ShaderMaterial;
    expect(material.blending).toBe(THREE.CustomBlending);
    expect(material.blendSrc).toBe(THREE.OneFactor);
    expect(material.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
  });

  it("draws as many sprites as it is given, growing past its first size", () => {
    const layer = buildEffectsLayer();
    layer.update(withSprites(3, 0));
    expect(spriteGeometry(layer).instanceCount).toBe(3);
    layer.update(withSprites(500, 0));
    expect(spriteGeometry(layer).instanceCount).toBe(500);
    layer.dispose();
  });

  it("looks each sprite's bitmap up in the atlas, and marks a missing one to draw soft and round", () => {
    const layer = buildEffectsLayer();
    layer.setAtlas({
      texture: new THREE.Texture(),
      rects: [[0, 0, 0.5, 0.5], null],
      smokeCount: 1,
    });
    layer.update(withSprites(1, 0));
    expect(
      Array.from(spriteGeometry(layer).getAttribute("uvRect").array).slice(
        0,
        4,
      ),
    ).toEqual([0, 0, 0.5, 0.5]);

    layer.update(withSprites(1, 1));
    expect(spriteGeometry(layer).getAttribute("uvRect").array[0]).toBeLessThan(
      0,
    );
    layer.dispose();
  });

  it("writes a bolt's axis and half length onto the instanced attributes", () => {
    const layer = buildEffectsLayer();
    layer.update(withSprites(1, 0, [0, 0, 1], 5));
    expect(
      Array.from(spriteGeometry(layer).getAttribute("axis").array).slice(0, 3),
    ).toEqual([0, 0, 1]);
    expect(spriteGeometry(layer).getAttribute("halfLength").array[0]).toBe(5);
    layer.dispose();
  });

  it("writes a flat sprite's side onto the instanced attributes", () => {
    const layer = buildEffectsLayer();
    layer.update(withSprites(1, 0, [1, 0, 0], 5, [0, 0, 1]));
    expect(
      Array.from(spriteGeometry(layer).getAttribute("side").array).slice(0, 3),
    ).toEqual([0, 0, 1]);
    layer.dispose();
  });

  it("applies a new atlas to the sprites it already has", () => {
    const layer = buildEffectsLayer();
    layer.update(withSprites(1, 0));
    expect(spriteGeometry(layer).getAttribute("uvRect").array[0]).toBeLessThan(
      0,
    );

    layer.setAtlas({
      texture: new THREE.Texture(),
      rects: [[0.25, 0, 0.5, 0.5]],
      smokeCount: 3,
    });
    expect(spriteGeometry(layer).getAttribute("uvRect").array[0]).toBe(0.25);
    expect(layer.smokeCount).toBe(3);
    layer.dispose();
  });
});
