// @vitest-environment happy-dom

/**
 * A build picture is drawn at the size asked for, over the background asked for,
 * and the live view is put back as it was (issue #3347).
 *
 * There is no WebGL here. The renderer is a stand-in that records what it was
 * told, which is enough to say what the capture asked of it.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { captureThumbnail, THUMBNAIL_PIXELS } from "./thumbnail";

function fakeRenderer(maxTextureSize = 4096) {
  const calls: string[] = [];
  const seen: { background: unknown; ratio: number; size: number[] }[] = [];
  let ratio = 2;
  let size = [800, 600];
  const canvas = document.createElement("canvas");
  const scene = new THREE.Scene();
  const unit = new THREE.Group();
  unit.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)));
  scene.add(unit);
  const renderer = {
    capabilities: { maxTextureSize },
    domElement: canvas,
    getSize: (target: THREE.Vector2) => target.set(size[0], size[1]),
    getPixelRatio: () => ratio,
    setPixelRatio: (value: number) => {
      ratio = value;
      calls.push(`ratio ${value}`);
    },
    setSize: (width: number, height: number) => {
      size = [width, height];
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      calls.push(`size ${width}x${height}`);
    },
    render: (drawn: THREE.Scene) => {
      seen.push({ background: drawn.background, ratio, size: [...size] });
    },
  };
  return {
    renderer: renderer as unknown as THREE.WebGLRenderer,
    scene,
    unit,
    calls,
    seen,
    ratio: () => ratio,
    size: () => size,
  };
}

describe("captureThumbnail as a build picture", () => {
  it("draws at exactly the size asked for, whatever the screen's pixel ratio", () => {
    const { renderer, scene, unit, seen } = fakeRenderer();

    const picture = captureThumbnail(renderer, scene, unit, [], {
      pixels: 64,
      background: null,
      view: [9, 7, 11],
    });

    expect(seen[0].ratio).toBe(1);
    expect(seen[0].size).toEqual([64, 64]);
    expect(picture.width).toBe(64);
    expect(picture.height).toBe(64);
  });

  it("draws over the colour asked for, and over nothing for a transparent one", () => {
    const first = fakeRenderer();
    captureThumbnail(first.renderer, first.scene, first.unit, [], {
      pixels: 64,
      background: "#336699",
      view: [9, 7, 11],
    });
    expect((first.seen[0].background as THREE.Color).getHexString()).toBe(
      "336699",
    );

    const second = fakeRenderer();
    second.scene.background = new THREE.Color("#ff0000");
    captureThumbnail(second.renderer, second.scene, second.unit, [], {
      pixels: 64,
      background: null,
      view: [9, 7, 11],
    });
    expect(second.seen[0].background).toBeNull();
  });

  it("puts the sky, the pixel ratio and the size back", () => {
    const fake = fakeRenderer();
    const sky = new THREE.Color("#112233");
    fake.scene.background = sky;

    captureThumbnail(fake.renderer, fake.scene, fake.unit, [], {
      pixels: 64,
      background: "#ffffff",
      view: [9, 7, 11],
    });

    expect(fake.scene.background).toBe(sky);
    expect(fake.ratio()).toBe(2);
    expect(fake.size()).toEqual([800, 600]);
  });

  it("draws no larger than the graphics card can", () => {
    const { renderer, scene, unit, seen } = fakeRenderer(512);

    captureThumbnail(renderer, scene, unit, [], {
      pixels: 4000,
      background: null,
      view: [9, 7, 11],
    });

    expect(seen[0].size).toEqual([512, 512]);
  });

  it("still takes the overview thumbnail at its own size when given no shot", () => {
    const { renderer, scene, unit, seen } = fakeRenderer();

    captureThumbnail(renderer, scene, unit, []);

    expect(seen[0].size).toEqual([THUMBNAIL_PIXELS, THUMBNAIL_PIXELS]);
    expect(seen[0].ratio).toBe(2);
  });
});
