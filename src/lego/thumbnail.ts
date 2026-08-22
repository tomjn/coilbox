/**
 * The picture of a unit that the overview shows.
 *
 * A thumbnail is the unit and nothing else. The viewport it comes from can be
 * showing a grid, a sky, terrain, a gizmo, highlights, a facing marker or a
 * collision volume, none of which say anything about the unit, so a thumbnail
 * that took the view as it found it made two units saved minutes apart look
 * like they came from different tools. The camera is placed from the unit's own
 * bounds for the same reason: how a unit is framed cannot depend on where the
 * builder happened to leave the view.
 *
 * There is no background at all, so the overview's own card colour shows
 * through. That is the plain backdrop the builder has always had, and it is the
 * one neutral surface that suits every part colour.
 *
 * The scene is the live one, borrowed for a single frame, so everything turned
 * off here is turned back on before it returns. The pixels are copied in the
 * same task as the draw, because a WebGL canvas discards its drawing buffer as
 * soon as the frame is composited and reads blank after that.
 */

import * as THREE from "three";

import { frameBox } from "./framing";
import type { Vec3 } from "./snapping";

/** The square the frame is drawn at, in CSS pixels. The stored file comes off
 *  it and is smaller still: see `saveThumbnail`. */
const THUMBNAIL_PIXELS = 320;

/**
 * Where the camera sits, as a direction from the unit: above it, in front of it
 * and off to one side. The same three-quarter view the builder opens on,
 * because that is the view of a unit people already recognise.
 */
export const THUMBNAIL_VIEW: Vec3 = [9, 7, 11];

/** The same lens as the builder's viewport, so a unit is the shape in the
 *  overview that it is in the editor. */
const THUMBNAIL_FOV = 40;

/** How far the camera can see when the unit is no bigger than one built out of
 *  lego parts. It grows with the unit: see `thumbnailCamera`. The same figure
 *  the viewport's own far plane starts at. */
const MIN_THUMBNAIL_FAR = 500;

/**
 * Draw `unit` on its own and hand back a canvas holding the pixels.
 *
 * `chrome` is whatever is drawn on the pieces themselves rather than beside
 * them: those hang off the unit, so the sweep over the scene cannot reach them.
 */
export function captureThumbnail(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  unit: THREE.Object3D,
  chrome: (THREE.Object3D | null)[],
): HTMLCanvasElement {
  const restore = hideChrome(scene, unit, chrome);
  const size = renderer.getSize(new THREE.Vector2());
  // Square, so the framing is the same whatever shape the panel is. The style
  // is left alone, so the canvas stays the size the page laid it out at.
  renderer.setSize(THUMBNAIL_PIXELS, THUMBNAIL_PIXELS, false);
  renderer.render(scene, thumbnailCamera(unit));

  const source = renderer.domElement;
  const thumb = document.createElement("canvas");
  thumb.width = source.width;
  thumb.height = source.height;
  thumb.getContext("2d")?.drawImage(source, 0, 0);

  renderer.setSize(size.x, size.y, false);
  restore();
  return thumb;
}

/**
 * Whether there is a picture of `unit` to take yet: it has geometry in it, and
 * every texture it draws with has its pixels.
 *
 * A texture the loader has not finished with samples as a single black pixel, so
 * a capture taken before then is a black unit rather than the unit. three's
 * loaders do not report back to whoever holds the texture, so what a texture has
 * is read off the texture itself: an image with a width is one that arrived,
 * whether it was decoded by the browser or uploaded still compressed.
 *
 * Both of an `.s3o`'s textures, because the second one decides which pixels are
 * drawn at all. That one samples as zero rather than as black before it arrives,
 * so a capture taken too early is an empty picture rather than a dark one.
 */
export function readyToCapture(unit: THREE.Object3D): boolean {
  let meshes = 0;
  let waiting = 0;
  unit.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes += 1;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      for (const texture of [standard.map, standard.alphaMap]) {
        // `image` is whatever the loader put there: an `HTMLImageElement`, an
        // `ImageBitmap`, or a compressed texture's dimensions. All three carry a
        // width once they hold anything.
        const image = texture?.image as { width?: number } | undefined;
        if (texture && !image?.width) waiting += 1;
      }
    }
  });
  return meshes > 0 && waiting === 0;
}

/**
 * Where to look at a unit from, whatever the builder's own camera is doing.
 *
 * A unit with nothing in it yet has no bounds to frame, so the camera keeps the
 * view's own distance and looks at the origin, which is where an empty unit is.
 */
export function thumbnailCamera(unit: THREE.Object3D): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(
    THUMBNAIL_FOV,
    1,
    0.05,
    MIN_THUMBNAIL_FAR,
  );
  const box = new THREE.Box3().setFromObject(unit);
  if (box.isEmpty()) {
    camera.position.set(...THUMBNAIL_VIEW);
    camera.lookAt(0, 0, 0);
    return camera;
  }

  const { target, position } = frameBox(
    {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    },
    THUMBNAIL_VIEW,
    THREE.MathUtils.degToRad(THUMBNAIL_FOV),
  );
  camera.position.set(...position);
  camera.lookAt(...target);

  // Far enough to still draw the back of the unit from wherever framing put the
  // camera. A unit big enough to want a camera past the fixed 500 this started
  // at would be cut off whole by the far plane, which is the same cropping the
  // framing distance used to cause, one step further along.
  camera.far = Math.max(
    MIN_THUMBNAIL_FAR,
    camera.position.distanceTo(new THREE.Vector3(...target)) +
      box.getBoundingSphere(new THREE.Sphere()).radius,
  );
  camera.updateProjectionMatrix();
  return camera;
}

/**
 * Turn off everything in the scene that is not the unit, and answer with the
 * way back.
 *
 * A sweep rather than a list, so a view aid added later stays out of thumbnails
 * without anyone having to remember this file. Lights are the exception: they
 * are not drawn, and hiding them would leave the unit lit by nothing.
 *
 * What was already off stays off on the way back, so a restore never turns on
 * an aid the builder had switched off.
 */
export function hideChrome(
  scene: THREE.Scene,
  unit: THREE.Object3D,
  chrome: (THREE.Object3D | null)[],
): () => void {
  const hidden: THREE.Object3D[] = [];
  const hide = (object: THREE.Object3D | null) => {
    if (!object?.visible) return;
    object.visible = false;
    hidden.push(object);
  };

  for (const child of scene.children) {
    if (child === unit || child instanceof THREE.Light) continue;
    hide(child);
  }
  for (const object of chrome) hide(object);

  // The sky is a background rather than an object in the scene, so the sweep
  // does not reach it.
  const background = scene.background;
  scene.background = null;

  return () => {
    for (const object of hidden) object.visible = true;
    scene.background = background;
  };
}
