// @vitest-environment happy-dom

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { labelHeight } from "./labelSize";
import { buildSkeleton } from "./skeletonLayer";
import { label } from "./weaponReachLayer";

/** What the renderer does with a sprite: run its hook, read its height. */
function drawnHeight(sprite: THREE.Sprite, camera: THREE.Camera): number {
  sprite.onBeforeRender(
    {} as THREE.WebGLRenderer,
    new THREE.Scene(),
    camera,
    new THREE.BufferGeometry(),
    sprite.material,
    null as never,
  );
  return sprite.scale.y;
}

describe("labelHeight", () => {
  it("is a fixed share of the view in perspective", () => {
    expect(labelHeight(new THREE.PerspectiveCamera(40))).toBe(
      labelHeight(new THREE.PerspectiveCamera(60)),
    );
  });

  it("follows the visible height in orthographic views, which zoom changes", () => {
    const ortho = new THREE.OrthographicCamera(-50, 50, 50, -50);
    const wide = labelHeight(ortho);
    ortho.zoom = 4;

    expect(wide).toBeGreaterThan(0);
    expect(labelHeight(ortho)).toBeCloseTo(wide / 4, 10);
  });
});

describe("weapon range labels", () => {
  it("scale with the zoom of an orthographic camera", () => {
    const tag = label("1 Laser, stated range 300", "#fff");
    const ortho = new THREE.OrthographicCamera(-100, 100, 100, -100);
    const wide = drawnHeight(tag, ortho);
    ortho.zoom = 4;

    expect(wide).toBeGreaterThan(0.035);
    expect(drawnHeight(tag, ortho)).toBeCloseTo(wide / 4, 10);
  });

  it("keep the shape of their text", () => {
    const tag = label("1 Laser, stated range 300", "#fff");
    const aspect = tag.scale.x / tag.scale.y;
    drawnHeight(tag, new THREE.OrthographicCamera(-100, 100, 100, -100));

    expect(tag.scale.x / tag.scale.y).toBeCloseTo(aspect, 10);
  });
});

describe("skeleton labels", () => {
  it("size the same way as the weapon labels", () => {
    const skeleton = buildSkeleton(
      [{ pieceId: "a", label: "Body", at: [0, 10, 0], parentAt: null }],
      new THREE.PointsMaterial(),
    ) as THREE.Group;
    const tag = skeleton.children.find(
      (c) => c instanceof THREE.Sprite,
    ) as THREE.Sprite;
    const ortho = new THREE.OrthographicCamera(-100, 100, 100, -100);

    expect(drawnHeight(tag, ortho)).toBeCloseTo(labelHeight(ortho), 10);
  });
});
