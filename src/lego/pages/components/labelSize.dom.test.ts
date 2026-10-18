// @vitest-environment happy-dom

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { LABEL_PX, LABEL_TEXT_PX } from "./labelSize";
import { buildSkeleton } from "./skeletonLayer";
import { label } from "./weaponReachLayer";

/** What the renderer does with a sprite: run its hook for a view
 *  `viewportHeight` CSS pixels tall. */
function runHook(
  sprite: THREE.Sprite,
  camera: THREE.Camera,
  viewportHeight: number,
): void {
  const renderer = {
    getSize: (target: THREE.Vector2) => target.set(900, viewportHeight),
  } as THREE.WebGLRenderer;
  sprite.onBeforeRender(
    renderer,
    new THREE.Scene(),
    camera,
    new THREE.BufferGeometry(),
    sprite.material,
    null as never,
  );
}

/**
 * The label's drawn height in CSS pixels when it sits `distance` in front of
 * the camera, worked out as three's sprite shader does with sizeAttenuation
 * off: the quad is `scale.y` view units tall, times the depth in a perspective
 * camera, and then projected.
 */
function screenHeight(
  sprite: THREE.Sprite,
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  viewportHeight: number,
  distance: number,
): number {
  camera.updateProjectionMatrix();
  runHook(sprite, camera, viewportHeight);
  const tall =
    camera instanceof THREE.PerspectiveCamera
      ? sprite.scale.y * distance
      : sprite.scale.y;
  const bottom = new THREE.Vector3(0, 0, -distance).applyMatrix4(
    camera.projectionMatrix,
  );
  const top = new THREE.Vector3(0, tall, -distance).applyMatrix4(
    camera.projectionMatrix,
  );
  return ((top.y - bottom.y) * viewportHeight) / 2;
}

const perspective = () => new THREE.PerspectiveCamera(40, 1.5, 0.05, 50000);
const ortho = (half: number) =>
  new THREE.OrthographicCamera(
    -half * 1.5,
    half * 1.5,
    half,
    -half,
    0.05,
    50000,
  );

describe("label size on screen", () => {
  const tag = label("Front right thigh", "#fff");

  it("is the app's small text, plus the plate around it", () => {
    expect(LABEL_TEXT_PX).toBe(12);
    expect(LABEL_PX).toBeGreaterThan(LABEL_TEXT_PX);
    expect(LABEL_PX).toBeLessThan(2 * LABEL_TEXT_PX);
  });

  it("stays the same at any distance in perspective", () => {
    expect(screenHeight(tag, perspective(), 800, 2)).toBeCloseTo(LABEL_PX, 6);
    expect(screenHeight(tag, perspective(), 800, 2000)).toBeCloseTo(
      LABEL_PX,
      6,
    );
  });

  it("stays the same at any zoom and frustum size in the orthographic views", () => {
    const camera = ortho(50);
    expect(screenHeight(tag, camera, 800, 100)).toBeCloseTo(LABEL_PX, 6);
    camera.zoom = 4;
    expect(screenHeight(tag, camera, 800, 100)).toBeCloseTo(LABEL_PX, 6);
    expect(screenHeight(tag, ortho(2000), 800, 100)).toBeCloseTo(LABEL_PX, 6);
  });

  it("does not grow with the viewport", () => {
    expect(screenHeight(tag, perspective(), 400, 10)).toBeCloseTo(LABEL_PX, 6);
    expect(screenHeight(tag, ortho(50), 1600, 10)).toBeCloseTo(LABEL_PX, 6);
  });

  it("keeps the shape of the text", () => {
    const aspect = tag.scale.x / tag.scale.y;
    runHook(tag, ortho(100), 800);

    expect(tag.scale.x / tag.scale.y).toBeCloseTo(aspect, 10);
  });
});

describe("skeleton labels", () => {
  it("size the same way as the weapon labels", () => {
    const skeleton = buildSkeleton(
      [
        {
          pieceId: "a",
          label: "Body",
          at: [0, 10, 0],
          parentAt: null,
          parentId: null,
        },
      ],
      new THREE.PointsMaterial(),
    ) as THREE.Group;
    const tag = skeleton.children.find(
      (c) => c instanceof THREE.Sprite,
    ) as THREE.Sprite;

    expect(screenHeight(tag, ortho(100), 800, 50)).toBeCloseTo(LABEL_PX, 6);
    expect(screenHeight(tag, perspective(), 800, 50)).toBeCloseTo(LABEL_PX, 6);
  });
});
