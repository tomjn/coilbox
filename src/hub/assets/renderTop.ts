/**
 * A unit's top down render, the picture a blueprint actually wants (issue #1631).
 *
 * The hub draws a blueprint as one rounded square per building, sized by its
 * footprint. A render of the real model scaled to that footprint is a much better
 * picture, and a build pic is not: a build pic is a three quarter icon at a fixed
 * size and does not tile into a base layout.
 *
 * Sending the model instead is the thing being avoided. Models carry licensing
 * questions per game and per unit pack, they are large, and a browser would need
 * the s3o and 3do readers plus DDS textures to use one. Coilbox has all of that
 * already and can send one small image.
 *
 * The drawing happens here rather than in the worker because the readers, the
 * textures and a GL context are all already here, and the encoding happens in the
 * worker because that is the corpus's one encoder. `unitsync_unit_render` is the
 * seam: it takes these pixels, checks them against the frame the footprint says
 * they should be, and hands them to libwebp.
 */

import * as THREE from "three";
import type { UnitModelResult } from "@/content/bindings";
import { buildModel } from "@/content/unitModel";
import { readyToCapture } from "@/lego/thumbnail";
import { type RenderFrame, renderFrame } from "./vocabulary";

/**
 * Which renderer drew a picture, and part of what its `source_hash` is over.
 *
 * **Bump this when a change here changes what a render looks like**: the camera,
 * the lights, the team colour, the model reader or the texture handling. That is
 * the whole mechanism for telling a renderer change from an encoder change. An
 * encoder change moves `encode_profile` and must leave `source_hash` alone, or
 * re-encoding the corpus reports every row in it as changed. A renderer change is
 * the opposite case: the picture really is different and the hub should be told,
 * so it moves `source_hash`, and this constant is how.
 *
 * Fixing something that does not change the picture is not a bump.
 */
export const RENDER_VERSION = 1;

/** How far above and below the model the camera's clip range reaches, in elmos,
 *  so a model sitting exactly on a clip plane is not shaved. */
const DEPTH_MARGIN = 16;

/** One unit's render, ready for the encoder. */
export interface TopDownRender {
  width: number;
  height: number;
  /**
   * Four channels a pixel, straight alpha, top row first. Straight rather than
   * premultiplied because that is what WebP stores, and top row first because
   * that is what an image is: GL hands the framebuffer back the other way up.
   */
  rgba: Uint8Array;
  /** The frame it was taken in, so the caller can tell the worker the same
   *  numbers it was drawn to. */
  frame: RenderFrame;
}

/**
 * The camera a top down render is taken with, orthographic and centred on the
 * unit's own origin.
 *
 * **Centred on the origin rather than on the model's bounds.** The engine places
 * a unit's model at the unit's position and the footprint is centred there, so an
 * asymmetric model overhangs its footprint unevenly and framing on its bounds
 * would slide it off the squares the consumer is going to line it up against.
 *
 * **Orientation**, which is easier to rediscover wrongly than to look up. The
 * model's `+z` is the front and its `+x` is the unit's left. Looking down, the
 * front is the top of the image and the unit's left is the left of the image, so
 * the image's rightwards axis is world `-x` and its downwards axis is world `-z`.
 * That falls out of `up` being world `+z` with the camera looking straight down:
 * three builds the camera's right as `up × (eye - target)`, which is
 * `(0,0,1) × (0,1,0) = (-1,0,0)`.
 *
 * `box` is the model's own bounds, and only decides the clip range. A unit is
 * tens of elmos tall and the ortho extent is the footprint's, so the two are
 * independent.
 */
export function topDownCamera(
  frame: RenderFrame,
  box: THREE.Box3,
): THREE.OrthographicCamera {
  const halfWidth = frame.widthElmos / 2;
  const halfHeight = frame.heightElmos / 2;

  const top = Math.max(box.isEmpty() ? 0 : box.max.y, 0) + DEPTH_MARGIN;
  const bottom = Math.min(box.isEmpty() ? 0 : box.min.y, 0) - DEPTH_MARGIN;

  const camera = new THREE.OrthographicCamera(
    -halfWidth,
    halfWidth,
    halfHeight,
    -halfHeight,
    0,
    top - bottom,
  );
  camera.up.set(0, 0, 1);
  camera.position.set(0, top, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

/**
 * What a render is lit by, which is fixed rather than borrowed from whatever
 * viewport asked for it.
 *
 * Looking straight down at a model lit only from straight above gives a flat
 * picture with no edges in it, so the key light is off to one side and there is a
 * fill from the other. These values are part of what a render is, so changing one
 * is a {@link RENDER_VERSION} bump.
 */
export function renderLights(): THREE.Light[] {
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(0.45, 1, 0.3);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.8);
  fill.position.set(-0.5, 0.4, -0.6);
  return [key, fill, new THREE.AmbientLight(0xffffff, 0.7)];
}

/**
 * Turn `rgba` the right way up, in place.
 *
 * `gl.readPixels` starts at the bottom left of the framebuffer, and an image
 * starts at the top left. Getting this wrong flips a render vertically, which
 * reads as a plausible picture of a symmetric building and as the wrong picture
 * of anything with a front.
 */
export function flipRows(
  rgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const stride = width * 4;
  const row = new Uint8Array(stride);
  for (let y = 0; y < Math.floor(height / 2); y += 1) {
    const topAt = y * stride;
    const bottomAt = (height - 1 - y) * stride;
    row.set(rgba.subarray(topAt, topAt + stride));
    rgba.copyWithin(topAt, bottomAt, bottomAt + stride);
    rgba.set(row, bottomAt);
  }
  return rgba;
}

/**
 * Recover straight alpha from what multisampling leaves behind, in place.
 *
 * The model is drawn opaque on a clear background, so every sample is either the
 * shaded colour at full alpha or nothing at all. Resolving a partly covered pixel
 * averages those, which gives `(colour * coverage, coverage)`: the colour comes
 * out already multiplied by the alpha. Storing that as straight alpha would draw
 * a dark fringe all the way round the silhouette, so the coverage is divided back
 * out.
 *
 * Only the edges are affected. Inside the model the alpha is 255 and this is the
 * identity, and outside it the alpha is 0 and there is no colour to recover.
 */
export function unpremultiply(rgba: Uint8Array): Uint8Array {
  for (let at = 0; at < rgba.length; at += 4) {
    const alpha = rgba[at + 3];
    if (alpha === 0 || alpha === 255) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      rgba[at + channel] = Math.min(
        255,
        Math.round((rgba[at + channel] * 255) / alpha),
      );
    }
  }
  return rgba;
}

/**
 * Draw `model` from above, framed on a `footprintX` by `footprintZ` footprint.
 *
 * Waits for the model's textures first: three's loaders do not report back to
 * whoever holds a texture, and one that has not arrived samples as a single black
 * pixel, so a render taken too early is a black unit rather than the unit.
 *
 * The pixels are read out of the framebuffer in the same task as the draw. A
 * WebGL drawing buffer is discarded as soon as the frame is composited and reads
 * blank after that, which is the one thing about this that is easy to get wrong
 * and the reason `captureThumbnail` says so too.
 */
export async function renderTopDown(
  model: UnitModelResult,
  footprintX: number,
  footprintZ: number,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<TopDownRender> {
  const frame = renderFrame(footprintX, footprintZ);
  const built = buildModel(model);

  const scene = new THREE.Scene();
  scene.background = null;
  for (const light of renderLights()) scene.add(light);
  scene.add(built.object);

  const renderer = new THREE.WebGLRenderer({
    canvas: document.createElement("canvas"),
    alpha: true,
    antialias: true,
    // Straight alpha out, so the only thing between the framebuffer and the
    // encoder is the multisample resolve, which `unpremultiply` undoes.
    premultipliedAlpha: false,
  });

  try {
    await waitForTextures(built.object, timeoutMs);

    // One device pixel per image pixel: the frame is in pixels already and a
    // retina scale factor would silently render it at twice the size.
    renderer.setPixelRatio(1);
    renderer.setSize(frame.widthPx, frame.heightPx, false);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, topDownCamera(frame, built.box));

    const rgba = new Uint8Array(frame.widthPx * frame.heightPx * 4);
    const gl = renderer.getContext();
    gl.readPixels(
      0,
      0,
      frame.widthPx,
      frame.heightPx,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      rgba,
    );

    return {
      width: frame.widthPx,
      height: frame.heightPx,
      rgba: unpremultiply(flipRows(rgba, frame.widthPx, frame.heightPx)),
      frame,
    };
  } finally {
    built.dispose();
    renderer.dispose();
  }
}

/**
 * How many bytes go into one `String.fromCharCode` call.
 *
 * `fromCharCode(...bytes)` spreads its argument onto the stack, and a quarter of
 * a megabyte of render overruns it. 8192 is well inside every engine's argument
 * limit and turns the encode into a few dozen calls.
 */
const BASE64_CHUNK = 8192;

/**
 * Standard base64, which is how a render's pixels reach the command.
 *
 * Standard rather than the base64url `container.ts` uses, because the Rust side
 * decodes with `general_purpose::STANDARD` and the two alphabets differ in two
 * characters, which shows up as a decode failure roughly whenever the pixels
 * happen to contain a `>` or a `?` sextet.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + BASE64_CHUNK));
  }
  return btoa(binary);
}

/**
 * Wait until every texture the model draws with has its pixels, or until the
 * time runs out.
 *
 * A timeout rather than a hang: a texture the archive does not hold never
 * arrives, and a unit drawn plain is a better answer than a spinner that never
 * stops. `readyToCapture` is the unit builder's own check, and it reads what a
 * texture has off the texture rather than off the loader for the same reason.
 */
async function waitForTextures(
  unit: THREE.Object3D,
  timeoutMs: number,
): Promise<void> {
  const until = performance.now() + timeoutMs;
  while (!readyToCapture(unit) && performance.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
