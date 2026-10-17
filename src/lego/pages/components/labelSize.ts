/**
 * How the unit builder's text labels (the skeleton's role names, the weapon
 * rings' range tags) keep one size on screen.
 *
 * A label is a sprite with `sizeAttenuation: false`. three.js draws such a
 * sprite `scale` view units tall, times the depth in a perspective camera, and
 * then projects it. Either way its height in clip space is `scale` times the
 * projection matrix's y scale, so one formula gives a fixed pixel height in
 * the perspective view and in the front, side and top views (#3323, #4481).
 */

import * as THREE from "three";

/** The label text's height on screen, in CSS pixels: the app's small text,
 *  Tailwind's `text-xs`. */
export const LABEL_TEXT_PX = 12;
/** The font size a label's text is drawn at on its canvas. */
export const LABEL_CANVAS_FONT = 28;
/** The canvas space above and below the text, in canvas pixels. */
export const LABEL_CANVAS_PAD = 8;
/** A label plate's height on screen, in CSS pixels. */
export const LABEL_PX =
  (LABEL_TEXT_PX * (LABEL_CANVAS_FONT + 2 * LABEL_CANVAS_PAD)) /
  LABEL_CANVAS_FONT;

/** The `scale` that draws a label `LABEL_PX` tall in a view `viewportHeight`
 *  CSS pixels tall. */
export function labelHeight(
  camera: THREE.Camera,
  viewportHeight: number,
): number {
  return (
    (2 * LABEL_PX) / (viewportHeight * camera.projectionMatrix.elements[5])
  );
}

/** A label's size on screen, in CSS pixels. */
export function labelPixelSize(sprite: THREE.Sprite): {
  width: number;
  height: number;
} {
  return {
    width: (LABEL_PX * sprite.scale.x) / sprite.scale.y,
    height: LABEL_PX,
  };
}

const SIZE = new THREE.Vector2();

/** Makes `sprite` take its height from the camera and the view each time it
 *  is drawn, keeping the width-to-height ratio it has now. */
export function keepLabelSize(sprite: THREE.Sprite): void {
  const aspect = sprite.scale.x / sprite.scale.y;
  sprite.onBeforeRender = (renderer, _scene, camera) => {
    const height = labelHeight(camera, renderer.getSize(SIZE).y || 1);
    sprite.scale.set(height * aspect, height, 1);
    // three reads the world matrix straight after this returns.
    sprite.updateMatrixWorld(true);
  };
}
