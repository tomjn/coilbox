import { describe, expect, it } from "vitest";
import { withFormSky } from "./mapinfoForm";
import {
  generateSkyPanorama,
  panoramaDirection,
  panoramaPixel,
  skyboxImageKind,
  skyInputs,
  type Vec3,
} from "./skyPanorama";

const W = 256;
const H = 128;

/** The pixel the engine samples for a world direction, step by step:
 * `SkyBox.cpp` draws with `uvFlip = (1, -1, 1)`, and `EquiRectConverterFS`
 * reads column `atan(z, x) / 2π + 0.5` and row `acos(-y) / π` for that cube
 * direction, with row 0 the image's top. */
function enginePixel([x, y, z]: Vec3): [number, number] {
  const cube: Vec3 = [x, -y, z];
  const u = Math.atan2(cube[2], cube[0]) / (2 * Math.PI) + 0.5;
  const v = Math.acos(-cube[1]) / Math.PI;
  return [u * W, v * H];
}

function pixel(px: Uint8ClampedArray, col: number, row: number) {
  const o = (row * W + col) * 4;
  return [px[o], px[o + 1], px[o + 2]];
}

describe("panorama orientation", () => {
  it("puts the top row straight up and the bottom straight down", () => {
    expect(panoramaDirection(0, 0, W, H)[1]).toBeGreaterThan(0.999);
    expect(panoramaDirection(0, H - 1, W, H)[1]).toBeLessThan(-0.999);
  });

  it("lands every direction on the pixel the engine samples", () => {
    const dirs: Vec3[] = [
      [1, 0.2, 0],
      [0, 0.5, 1],
      [-0.3, 0.8, -0.5],
      [0.6, -0.4, 0.7],
    ];
    for (const d of dirs) {
      const l = Math.hypot(...d);
      const n: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
      const [ec, er] = enginePixel(n);
      const [c, r] = panoramaPixel(n, W, H);
      expect(c).toBeCloseTo(ec, 6);
      expect(r).toBeCloseTo(er, 6);
    }
  });

  it("lands on the pixel three's equirectangular background samples", () => {
    // `equirectUv` in three's common.glsl: u = atan(z, x) / 2π + 0.5 and
    // v = asin(y) / π + 0.5, with v = 1 the image's top row (flipY).
    const n: Vec3 = [0.36, 0.48, -0.8];
    const u = Math.atan2(n[2], n[0]) / (2 * Math.PI) + 0.5;
    const v = Math.asin(n[1]) / Math.PI + 0.5;
    const [c, r] = panoramaPixel(n, W, H);
    expect(c).toBeCloseTo(u * W, 6);
    expect(r).toBeCloseTo((1 - v) * H, 6);
  });

  it("reads a pixel back as the direction it shows", () => {
    const d = panoramaDirection(40, 30, W, H);
    const [c, r] = panoramaPixel(d, W, H);
    expect(c).toBeCloseTo(40.5, 6);
    expect(r).toBeCloseTo(30.5, 6);
  });
});

describe("generated sky", () => {
  const app = {
    skyColor: [0.1, 0.2, 0.6] as Vec3,
    fogColor: [0.8, 0.6, 0.4] as Vec3,
    cloudDensity: 0,
    sunDir: [1, 0.5, 0] as Vec3,
    sunColor: [0, 1, 0] as Vec3,
    skySunColor: [1, 0.9, 0.5] as Vec3,
  };
  const px = generateSkyPanorama(app, W, H);

  it("meets the fog colour at the horizon", () => {
    // Far from the sun, so its glow adds almost nothing.
    const back = panoramaPixel([-1, 0, 0], W, H);
    const [r, g, b] = pixel(px, Math.floor(back[0]), H / 2);
    expect(Math.abs(r - 0.8 * 255)).toBeLessThanOrEqual(3);
    expect(Math.abs(g - 0.6 * 255)).toBeLessThanOrEqual(3);
    expect(Math.abs(b - 0.4 * 255)).toBeLessThanOrEqual(3);
  });

  it("is the sky colour overhead", () => {
    // Plus a little of the sun's wide glow, 63 degrees away.
    const [r, g, b] = pixel(px, W / 2, 0);
    expect(Math.abs(r - 0.1 * 255)).toBeLessThanOrEqual(6);
    expect(Math.abs(g - 0.2 * 255)).toBeLessThanOrEqual(6);
    expect(Math.abs(b - 0.6 * 255)).toBeLessThanOrEqual(6);
  });

  it("draws the sun where sunDir points, in atmosphere.sunColor", () => {
    let best = -1;
    let at = [0, 0];
    for (let row = 0; row < H; row++)
      for (let col = 0; col < W; col++) {
        const [r, g, b] = pixel(px, col, row);
        if (r + g + b > best) {
          best = r + g + b;
          at = [col, row];
        }
      }
    const [c, r] = panoramaPixel(skyInputs(app).sunDir, W, H);
    expect(Math.abs(at[0] - c)).toBeLessThanOrEqual(2);
    expect(Math.abs(at[1] - r)).toBeLessThanOrEqual(2);
    const [, g, b] = pixel(px, at[0], at[1]);
    // Warm like skySunColor, not green like lighting.sunColor.
    expect(b).toBeLessThan(g);
  });

  it("adds clouds only when the map asks for them", () => {
    const clear = generateSkyPanorama({ ...app, cloudDensity: 0 }, W, H);
    const cloudy = generateSkyPanorama({ ...app, cloudDensity: 0.8 }, W, H);
    expect(cloudy).not.toEqual(clear);
    // Nothing below the horizon changes.
    const below = W * (H / 2 + 4) * 4;
    expect(cloudy.slice(below)).toEqual(clear.slice(below));
  });

  it("falls back to the engine's own defaults", () => {
    const s = skyInputs(null);
    expect(s.skyColor).toEqual([0.1, 0.15, 0.7]);
    expect(s.fogColor).toEqual([0.7, 0.7, 0.8]);
    expect(s.cloudDensity).toBe(0.5);
  });
});

describe("skyboxImageKind", () => {
  it("tells the formats apart by their first bytes", () => {
    expect(skyboxImageKind(new Uint8Array([0x44, 0x44, 0x53, 0x20]))).toBe(
      "dds",
    );
    expect(skyboxImageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(
      "png",
    );
    expect(skyboxImageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "jpeg",
    );
    expect(skyboxImageKind(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});

describe("withFormSky", () => {
  it("lets the page's colours override the source folder's", () => {
    const merged = withFormSky(
      { skyColor: [0, 0, 1], fogColor: [1, 1, 1], sunColor: [0, 1, 0] },
      { fogColor: [0.5, 0.5, 0.5], sunColor: [1, 0, 0] },
    );
    expect(merged?.skyColor).toEqual([0, 0, 1]);
    expect(merged?.fogColor).toEqual([0.5, 0.5, 0.5]);
    // The page writes atmosphere.sunColor, which is the sky's sun only.
    expect(merged?.skySunColor).toEqual([1, 0, 0]);
    expect(merged?.sunColor).toEqual([0, 1, 0]);
  });
});
