import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { toBase64 } from "@/lib/base64";
import {
  flipRows,
  PICTURE_VIEWS,
  pictureCamera,
  RENDER_VERSION,
  topDownCamera,
  unpremultiply,
} from "./renderTop";
import { PICTURE_ANGLES, renderFrame } from "./vocabulary";

/**
 * The render itself needs a GL context, which this runner does not have. What it
 * can test is everything a wrong render would be wrong because of: where the
 * camera puts the world on the image, which way up the framebuffer comes back,
 * and what happens to the alpha at the silhouette.
 *
 * Orientation is the one worth the most here. A mirrored render looks entirely
 * fine, so a person checking a picture would pass it, and `+x` and `+z` are easy
 * to get backwards.
 */

/** Where a world point lands in normalised device coordinates: x is -1 at the
 *  left of the image and +1 at the right, y is -1 at the bottom and +1 at the
 *  top, which is the way up GL reads the framebuffer in. */
function ndc(camera: THREE.Camera, x: number, y: number, z: number) {
  const at = new THREE.Vector3(x, y, z).project(camera);
  return { x: at.x, y: at.y };
}

const anyBox = () =>
  new THREE.Box3(new THREE.Vector3(-40, 0, -40), new THREE.Vector3(40, 30, 40));

describe("where the camera puts the model", () => {
  it("looks straight down at the unit's own origin", () => {
    const camera = topDownCamera(renderFrame(3, 2), anyBox());
    const centre = ndc(camera, 0, 0, 0);
    expect(centre.x).toBeCloseTo(0);
    expect(centre.y).toBeCloseTo(0);

    // Not the model's bounds: the engine centres a footprint on the unit's
    // origin, so a model that leans one way still sits on its own squares.
    const leaning = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(64, 30, 64),
    );
    const same = topDownCamera(renderFrame(3, 2), leaning);
    expect(ndc(same, 0, 0, 0)).toEqual(centre);
  });

  /**
   * The model's `+x` is the unit's left, and the unit's left is the left of the
   * image, so world `-x` has to come out on the right. Getting this backwards
   * mirrors every render in the corpus and nothing downstream would notice.
   */
  it("puts world -x on the right of the image", () => {
    const camera = topDownCamera(renderFrame(3, 2), anyBox());
    expect(ndc(camera, -8, 0, 0).x).toBeGreaterThan(0);
    expect(ndc(camera, 8, 0, 0).x).toBeLessThan(0);
    // And the axis it is not: moving along x must not move the image vertically.
    expect(ndc(camera, -8, 0, 0).y).toBeCloseTo(0);
  });

  /**
   * The model's `+z` is the front and the front is the top of the image, so world
   * `-z` is the bottom. In NDC the bottom is negative, and after the framebuffer
   * is flipped that is the last row of the image.
   */
  it("puts world -z at the bottom of the image", () => {
    const camera = topDownCamera(renderFrame(3, 2), anyBox());
    expect(ndc(camera, 0, 0, -8).y).toBeLessThan(0);
    expect(ndc(camera, 0, 0, 8).y).toBeGreaterThan(0);
    expect(ndc(camera, 0, 0, -8).x).toBeCloseTo(0);
  });

  /** The two axes together, on a model with a front and a side, so a render that
   *  is right about one axis and mirrored about the other still fails. */
  it("lands an asymmetric model's corner in the right quadrant", () => {
    const camera = topDownCamera(renderFrame(3, 2), anyBox());
    // The unit's front left corner: +z is forward, +x is the unit's left.
    const frontLeft = ndc(camera, 16, 0, 16);
    expect(frontLeft.x).toBeLessThan(0); // the image's left
    expect(frontLeft.y).toBeGreaterThan(0); // the image's top
    // And its back right corner is the opposite one.
    const backRight = ndc(camera, -16, 0, -16);
    expect(backRight.x).toBeGreaterThan(0);
    expect(backRight.y).toBeLessThan(0);
  });

  /** The extent is the footprint plus the bleed, so the footprint's own edge sits
   *  one square in from the edge of the picture on every side. */
  it("frames the footprint inset by one build square", () => {
    const frame = renderFrame(3, 2);
    const camera = topDownCamera(frame, anyBox());
    // 3 squares of 16 elmos wide, so the footprint's edge is at x = +-24 and
    // the picture's is at +-40.
    expect(ndc(camera, 24, 0, 0).x).toBeCloseTo(-24 / 40);
    expect(ndc(camera, 40, 0, 0).x).toBeCloseTo(-1);
    // 2 squares deep, so the footprint's edge is at z = +-16 against +-32.
    expect(ndc(camera, 0, 0, 16).y).toBeCloseTo(16 / 32);
    expect(ndc(camera, 0, 0, 32).y).toBeCloseTo(1);
  });

  /** A model taller than the clip range would be shaved off the top, and one
   *  that dips below the origin off the bottom. */
  it("clips past the model rather than through it", () => {
    const tall = new THREE.Box3(
      new THREE.Vector3(-10, -60, -10),
      new THREE.Vector3(10, 200, 10),
    );
    const camera = topDownCamera(renderFrame(3, 2), tall);
    for (const y of [200, 0, -60]) {
      const at = ndc(camera, 0, y, 0);
      expect(Math.abs(at.x)).toBeLessThan(1);
      expect(Math.abs(at.y)).toBeLessThan(1);
    }
  });
});

/**
 * The three angles that are pictures of a unit rather than plans of one
 * (issue #1951).
 *
 * Orientation is worth the most here for the reason the file's header gives: a
 * front view drawn from behind is a plausible picture of the wrong side, and
 * nobody reviewing a corpus of them would catch it.
 */
describe("where the camera puts the model for a picture", () => {
  /**
   * Standing in front of a unit and looking at it, its left hand is on your
   * right. The model's `+x` is the unit's left, so `+x` has to come out on the
   * right of the image.
   */
  it("puts the unit's left on the right of a front view", () => {
    const camera = pictureCamera("front", anyBox());
    expect(ndc(camera, 30, 0, 0).x).toBeGreaterThan(0);
    expect(ndc(camera, -30, 0, 0).x).toBeLessThan(0);
  });

  /**
   * `side` looks from off the unit's left, which is `+x`. Standing there, the
   * unit's nose points away to your left, so the front comes out on the left.
   */
  it("shows the unit facing left from its own left side", () => {
    const camera = pictureCamera("side", anyBox());
    expect(ndc(camera, 0, 0, 30).x).toBeLessThan(0);
    expect(ndc(camera, 0, 0, -30).x).toBeGreaterThan(0);
  });

  /** The three quarter view is above the unit, so the top of it is nearer the
   *  camera than the bottom. Being level with it would be a second front view. */
  it("looks down on the unit from an angle", () => {
    const camera = pictureCamera("angled", anyBox());
    expect(camera.position.y).toBeGreaterThan(0);
    expect(ndc(camera, 0, 30, 0).y).toBeGreaterThan(ndc(camera, 0, 0, 0).y);
  });

  /**
   * Framed on the model rather than on the origin, which is the opposite of the
   * plan's rule. A model that sits entirely off to one side of its own origin
   * still fills the picture, where a plan of it leans off its squares on purpose.
   */
  it("centres the model rather than the unit's origin", () => {
    const leaning = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(64, 30, 64),
    );
    for (const angle of PICTURE_ANGLES) {
      const camera = pictureCamera(angle, leaning);
      const middle = ndc(camera, 32, 15, 32);
      expect(middle.x).toBeCloseTo(0);
      expect(middle.y).toBeCloseTo(0);
    }
  });

  /** A model with nothing in it has no bounds to frame, and a camera at the
   *  model's own centre would divide by nothing. */
  it("still points at something for a model with no bounds", () => {
    for (const angle of PICTURE_ANGLES) {
      const camera = pictureCamera(angle, new THREE.Box3());
      expect(camera.position.length()).toBeGreaterThan(0);
      expect(Number.isFinite(camera.position.x)).toBe(true);
    }
  });

  /**
   * An angle the vocabulary lists and this file has no direction for would be
   * drawn from wherever the fallback points, which is a picture named after an
   * angle it was not taken at.
   */
  it("has a camera direction for every angle that is a picture", () => {
    expect(Object.keys(PICTURE_VIEWS).sort()).toEqual(
      [...PICTURE_ANGLES].sort(),
    );
  });
});

describe("what comes back out of the framebuffer", () => {
  /** GL reads from the bottom left and an image starts at the top left, so the
   *  rows come back the other way up. */
  it("turns the framebuffer the right way up", () => {
    // Two rows of one pixel: the first row read is the bottom of the image.
    const rows = new Uint8Array([1, 1, 1, 255, 2, 2, 2, 255]);
    expect(Array.from(flipRows(rows, 1, 2))).toEqual([
      2, 2, 2, 255, 1, 1, 1, 255,
    ]);
  });

  it("leaves an odd number of rows with its middle one in the middle", () => {
    const rows = new Uint8Array([
      1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255, 5, 0, 0, 255, 6,
      0, 0, 255,
    ]);
    const flipped = Array.from(flipRows(rows, 2, 3));
    expect(flipped[0]).toBe(5);
    expect(flipped[8]).toBe(3);
    expect(flipped[16]).toBe(1);
  });

  /** A resolved edge pixel comes out with its colour already multiplied by its
   *  coverage, and storing that as straight alpha draws a dark fringe. */
  it("recovers the colour multisampling multiplied by the coverage", () => {
    // Half covered: a pure red model resolves to (128, 0, 0, 128).
    const edge = new Uint8Array([128, 0, 0, 128]);
    expect(Array.from(unpremultiply(edge))).toEqual([255, 0, 0, 128]);
  });

  it("leaves the inside and the outside of the model alone", () => {
    const solid = new Uint8Array([200, 60, 40, 255, 0, 0, 0, 0]);
    expect(Array.from(unpremultiply(solid))).toEqual([
      200, 60, 40, 255, 0, 0, 0, 0,
    ]);
  });

  it("never pushes a channel past what a byte holds", () => {
    // A rounding error in the resolve can leave a channel above its alpha.
    const over = new Uint8Array([40, 0, 0, 30]);
    expect(unpremultiply(over)[0]).toBe(255);
  });
});

describe("how the pixels reach the command", () => {
  /** A render is a quarter of a megabyte, which is far past what spreading onto
   *  the stack survives, so the encode is chunked. */
  it("encodes a whole render without overrunning the stack", () => {
    const render = new Uint8Array(255 * 204 * 4);
    for (let at = 0; at < render.length; at += 1) render[at] = at % 256;
    const code = toBase64(render);
    expect(code.length).toBe(Math.ceil(render.length / 3) * 4);

    const back = Uint8Array.from(atob(code), (c) => c.charCodeAt(0));
    expect(back).toEqual(render);
  });

  /** The Rust side decodes with the standard alphabet, and base64url differs in
   *  exactly the two characters a byte stream of pixels hits constantly. */
  it("uses the standard alphabet rather than the url one", () => {
    expect(toBase64(new Uint8Array([0xfb, 0xef, 0xbe]))).toBe("++++");
    expect(toBase64(new Uint8Array([0xff, 0xff, 0xff]))).toBe("////");
    // And it pads, which base64url does not.
    expect(toBase64(new Uint8Array([0]))).toBe("AA==");
  });
});

describe("which renderer drew it", () => {
  /**
   * The version is in a render's `source_hash`, so it is the one thing here that
   * a change to this file has to be a deliberate decision about. Whole and
   * positive because the worker takes it as a `u32`.
   */
  it("is a whole positive number the worker can carry", () => {
    expect(Number.isInteger(RENDER_VERSION)).toBe(true);
    expect(RENDER_VERSION).toBeGreaterThan(0);
  });
});
