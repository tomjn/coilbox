import type { MapAppearance } from "./bindings";

/**
 * Flat 2:1 sky panoramas, read and written the way Recoil reads them (#5089).
 *
 * The engine loads `atmosphere.skyBox` from `maps/<skyBox>`. A 2D image is
 * turned into a cube map by `EquiRectConverterFS.glsl`, which samples column
 * `atan(z, x) / 2π + 0.5` and row `acos(-y) / π` for the cube direction. The
 * sky is then drawn with the direction's y flipped (`uvFlip` in `SkyBox.cpp`),
 * so for a world direction the row is `acos(y) / π`. PNG and JPG load with the
 * image's top row first (`IL_ORIGIN_UPPER_LEFT` in `Bitmap.cpp`), so the top
 * row is straight up. DDS files are flipped on load, which is why only PNG and
 * JPG are written here.
 *
 * World axes are the engine's: x east, y up, z south. The preview's three.js
 * scene uses the same axes, and three's equirectangular mapping samples the
 * same column and row for a direction, so a panorama shows in the preview as
 * it does in the engine.
 */

export type Rgb = [number, number, number];
export type Vec3 = [number, number, number];

/** The engine's own values for the keys the sky is built from
 * (`rts/Map/MapInfo.cpp`), used when `mapinfo.lua` leaves one out. */
export const ENGINE_SKY_DEFAULTS = {
  skyColor: [0.1, 0.15, 0.7] as Rgb,
  fogColor: [0.7, 0.7, 0.8] as Rgb,
  sunColor: [1, 1, 1] as Rgb,
  cloudColor: [1, 1, 1] as Rgb,
  cloudDensity: 0.5,
  sunDir: [0, 1, 2] as Vec3,
};

/** The size written into a map. The engine makes cube faces as tall as the
 * image, so this gives 1024 pixel faces. */
export const PANORAMA_WIDTH = 2048;
export const PANORAMA_HEIGHT = 1024;

/** The name written into `atmosphere.skyBox`. The file is `maps/skybox.jpg`. */
export const GENERATED_SKYBOX = "skybox.jpg";

/** The world direction the centre of pixel (`col`, `row`) shows. */
export function panoramaDirection(
  col: number,
  row: number,
  width: number,
  height: number,
): Vec3 {
  const phi = ((col + 0.5) / width - 0.5) * 2 * Math.PI;
  const theta = ((row + 0.5) / height) * Math.PI;
  const s = Math.sin(theta);
  return [s * Math.cos(phi), Math.cos(theta), s * Math.sin(phi)];
}

/** The pixel a world direction lands on, as fractional column and row. */
export function panoramaPixel(
  dir: Vec3,
  width: number,
  height: number,
): [number, number] {
  const [x, y, z] = normalise(dir);
  const u = Math.atan2(z, x) / (2 * Math.PI) + 0.5;
  const v = Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI;
  return [u * width, v * height];
}

/** What kind of image some skybox bytes are, by their first bytes. */
export function skyboxImageKind(
  bytes: Uint8Array,
): "dds" | "png" | "jpeg" | null {
  const at = (i: number) => bytes[i];
  if (at(0) === 0x44 && at(1) === 0x44 && at(2) === 0x53 && at(3) === 0x20)
    return "dds";
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47)
    return "png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  return null;
}

/** The colours and directions one sky is made from, with the engine's
 * defaults filled in. */
export interface SkyInputs {
  skyColor: Rgb;
  fogColor: Rgb;
  sunColor: Rgb;
  cloudColor: Rgb;
  cloudDensity: number;
  sunDir: Vec3;
}

/**
 * The sky inputs a map's `mapinfo.lua` gives. The sun is drawn in
 * `atmosphere.sunColor`, the one the engine's sky reads, never in
 * `lighting.sunColor`.
 */
export function skyInputs(app?: MapAppearance | null): SkyInputs {
  const d = ENGINE_SKY_DEFAULTS;
  return {
    skyColor: app?.skyColor ?? d.skyColor,
    fogColor: app?.fogColor ?? d.fogColor,
    sunColor: app?.skySunColor ?? d.sunColor,
    cloudColor: app?.cloudColor ?? d.cloudColor,
    cloudDensity: Math.max(0, app?.cloudDensity ?? d.cloudDensity),
    sunDir: normalise(app?.sunDir ?? d.sunDir),
  };
}

/** Angular radius of the sun disc, in radians. */
const SUN_RADIUS = 0.02;
/** How many cloud features cross the plane per unit of `x / y`. */
const CLOUD_SCALE = 2.2;
const CLOUD_OCTAVES = 5;

/**
 * The colour of the generated sky in one world direction, 0 to 1 per channel.
 *
 * The horizon is exactly `fogColor`, so terrain fogged out to the horizon
 * meets the sky with no seam, and it blends up to `skyColor` at the zenith.
 * Below the horizon is `fogColor` too. Clouds are noise on a flat plane above
 * the map, so they shrink and thin towards the horizon as real ones do.
 */
export function skyColourAt(dir: Vec3, sky: SkyInputs): Rgb {
  const [x, y, z] = dir;
  const up = Math.max(0, y);
  const t = (1 - up) ** 3;
  const out: Rgb = [0, 0, 0];
  for (let i = 0; i < 3; i++)
    out[i] = sky.skyColor[i] + (sky.fogColor[i] - sky.skyColor[i]) * t;

  const [sx, sy, sz] = sky.sunDir;
  const cos = Math.max(-1, Math.min(1, x * sx + y * sy + z * sz));
  const angle = Math.acos(cos);
  const glow = 0.45 * Math.exp(-angle / 0.08) + 0.18 * Math.exp(-angle / 0.45);
  for (let i = 0; i < 3; i++) out[i] += sky.sunColor[i] * glow;

  let cloud = 0;
  if (y > 0.01 && sky.cloudDensity > 0) {
    const px = (x / y) * CLOUD_SCALE;
    const pz = (z / y) * CLOUD_SCALE;
    const n = fbm(px, pz);
    const cover = Math.min(1, sky.cloudDensity);
    cloud = smoothstep(1 - cover, 1.25 - cover, n) * smoothstep(0.01, 0.3, y);
    const shade = 0.78 + 0.22 * n + 0.3 * glow;
    for (let i = 0; i < 3; i++) {
      const c = sky.cloudColor[i] * shade;
      out[i] += (c - out[i]) * cloud * 0.9;
    }
  }

  // The disc is sunColor lifted halfway to white, so a dim sun still reads
  // as the brightest thing in its own glow rather than a dark spot in it.
  const disc = 1 - smoothstep(SUN_RADIUS * 0.8, SUN_RADIUS, angle);
  for (let i = 0; i < 3; i++)
    out[i] += (0.5 + 0.5 * sky.sunColor[i] - out[i]) * disc * (1 - cloud);

  for (let i = 0; i < 3; i++) out[i] = Math.max(0, Math.min(1, out[i]));
  return out;
}

/** RGBA bytes of the generated sky, top row first, as an image stores them. */
export function generateSkyPanorama(
  app: MapAppearance | null | undefined,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const sky = skyInputs(app);
  const px = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const c = skyColourAt(panoramaDirection(col, row, width, height), sky);
      const o = (row * width + col) * 4;
      px[o] = Math.round(c[0] * 255);
      px[o + 1] = Math.round(c[1] * 255);
      px[o + 2] = Math.round(c[2] * 255);
      px[o + 3] = 255;
    }
  }
  return px;
}

/** The generated sky as JPEG bytes, ready to be `maps/skybox.jpg`. */
export async function panoramaJpeg(
  app: MapAppearance | null | undefined,
): Promise<Uint8Array> {
  const pixels = generateSkyPanorama(app, PANORAMA_WIDTH, PANORAMA_HEIGHT);
  const canvas = document.createElement("canvas");
  canvas.width = PANORAMA_WIDTH;
  canvas.height = PANORAMA_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2D canvas to encode the sky with");
  ctx.putImageData(
    new ImageData(pixels, PANORAMA_WIDTH, PANORAMA_HEIGHT),
    0,
    0,
  );
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );
  if (!blob) throw new Error("the sky would not encode as a JPEG");
  return new Uint8Array(await blob.arrayBuffer());
}

function normalise(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0];
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hash(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Fractal noise in 0 to 1. */
function fbm(x: number, z: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < CLOUD_OCTAVES; o++) {
    sum += valueNoise(x * f, z * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}
