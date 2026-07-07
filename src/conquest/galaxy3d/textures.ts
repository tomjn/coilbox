import * as THREE from "three";

/**
 * Shared canvas-drawn textures for the conquest 3D layers (the strategic map
 * and the battle backdrop). Computed per-pixel into ImageData rather than via
 * `createRadialGradient`: WebKit's CoreGraphics dithers canvas gradients with
 * per-channel noise, which — once magnified and additively blended — shows up
 * as coloured speckles on the stars. Pure maths has no dither.
 */

/** Parse `#rrggbb` / `#rrggbbaa` into 0-255 channels. */
export function hexRgba(hex: string): [number, number, number, number] {
  const h = hex.replace("#", "");
  const n = Number.parseInt(h.length === 6 ? `${h}ff` : h, 16);
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

/**
 * Radial-gradient sprite texture (star cores, glows and nebulae), lerped
 * per-pixel between the given colour stops.
 */
export function radialTexture(
  size: number,
  stops: [number, string][],
): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const rgba = stops.map(([at, color]) => [at, hexRgba(color)] as const);
    const img = ctx.createImageData(size, size);
    const half = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.min(
          1,
          Math.hypot(x + 0.5 - half, y + 0.5 - half) / half,
        );
        // Find the bracketing stops and lerp between them.
        let lo = rgba[0];
        let hi = rgba[rgba.length - 1];
        for (let i = 0; i < rgba.length - 1; i++) {
          if (d >= rgba[i][0] && d <= rgba[i + 1][0]) {
            lo = rgba[i];
            hi = rgba[i + 1];
            break;
          }
        }
        const span = hi[0] - lo[0];
        const t = span > 0 ? (d - lo[0]) / span : 0;
        const o = (y * size + x) * 4;
        for (let c = 0; c < 4; c++) {
          img.data[o + c] = Math.round(lo[1][c] + (hi[1][c] - lo[1][c]) * t);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A four-point diffraction-spike flare, computed per-pixel (dither-free): two
 * perpendicular arms with gaussian cross-sections that fade with distance —
 * the classic telescope-photograph star look.
 */
export function spikesTexture(size: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(size, size);
    const half = size / 2;
    const armWidth = size * 0.012;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = Math.abs(x + 0.5 - half);
        const dy = Math.abs(y + 0.5 - half);
        const armH =
          Math.exp(-(dy * dy) / (2 * armWidth * armWidth)) *
          Math.max(0, 1 - dx / half) ** 2;
        const armV =
          Math.exp(-(dx * dx) / (2 * armWidth * armWidth)) *
          Math.max(0, 1 - dy / half) ** 2;
        const v = Math.min(1, Math.max(armH, armV) * 1.2);
        const o = (y * size + x) * 4;
        img.data[o] = 255;
        img.data[o + 1] = 255;
        img.data[o + 2] = 255;
        img.data[o + 3] = Math.round(v * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
