/**
 * How the unit builder's text labels (the skeleton's role names, the weapon
 * rings' range tags) keep a readable size on screen.
 *
 * A sprite with `sizeAttenuation: false` holds a screen size only in a
 * perspective camera. An orthographic camera has no depth to scale by, so the
 * sprite would be `scale` world units tall at any zoom: a fraction of an elmo
 * in the front, side and top views (#3323).
 */

import * as THREE from "three";

/** A label's height as a share of the view's height. */
export const LABEL_SHARE = 0.035;
/**
 * The same share in an orthographic view: `LABEL_SHARE` over the height a
 * perspective view of 40 degrees shows at distance 1, which is what a
 * perspective label measures against.
 */
const ORTHO_LABEL_SHARE = LABEL_SHARE / (2 * Math.tan((40 * Math.PI) / 360));

/** The height a label is drawn at for `camera`, in world units. */
export function labelHeight(camera: THREE.Camera): number {
  if (camera instanceof THREE.OrthographicCamera) {
    return (ORTHO_LABEL_SHARE * (camera.top - camera.bottom)) / camera.zoom;
  }
  return LABEL_SHARE;
}

/** Makes `sprite` take its height from the camera each time it is drawn,
 *  keeping the width-to-height ratio it has now. */
export function keepLabelSize(sprite: THREE.Sprite): void {
  const aspect = sprite.scale.x / sprite.scale.y;
  sprite.onBeforeRender = (_renderer, _scene, camera) => {
    const height = labelHeight(camera);
    sprite.scale.set(height * aspect, height, 1);
    // three reads the world matrix straight after this returns.
    sprite.updateMatrixWorld(true);
  };
}
