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

/** GLSL-style deterministic hash, 0..1 (no RNG — keeps textures reproducible). */
function noise1(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * A lit asteroid for voidwater nodes: one hero rock with a scatter of debris.
 * Each rock is a shaded sphere (real surface normal → Lambert), so it reads as
 * a solid lit body, not a soft blob. Rocks composite front-most (nearest wins)
 * so overlaps occlude instead of stacking translucent alpha, and the silhouette
 * gets a hard ~1.5px edge. Greyscale, computed per-pixel (dither-free like the
 * star textures) — the sprite material supplies the stone colour.
 */
export function asteroidTexture(size: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(size, size);
    const half = size / 2;
    const px = 1 / half; // one pixel in normalised (-1..1) units
    // Light from upper-left-front (pre-normalised) — the classic lit-limb look.
    const L = [-0.4534, -0.5542, 0.7053] as const;
    // Deterministic rock field: a dominant hero plus falling-off debris/specks.
    // depth breaks overlap ties so the nearer/larger rock occludes.
    const rocks = [
      { cx: -0.04, cy: 0.06, r: 0.6, depth: 1.0, seed: 1 },
      { cx: 0.56, cy: -0.44, r: 0.13, depth: 0.35, seed: 2 },
      { cx: -0.52, cy: 0.52, r: 0.1, depth: 0.3, seed: 3 },
      { cx: 0.44, cy: 0.54, r: 0.07, depth: 0.25, seed: 4 },
      { cx: 0.66, cy: 0.12, r: 0.045, depth: 0.2, seed: 5 },
      { cx: -0.64, cy: -0.3, r: 0.038, depth: 0.2, seed: 6 },
    ] as const;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x + 0.5 - half) / half;
        const ny = (y + 0.5 - half) / half;
        let front = -Infinity;
        let value = 0;
        let alpha = 0;
        for (const rock of rocks) {
          const dx = nx - rock.cx;
          const dy = ny - rock.cy;
          const d = Math.hypot(dx, dy);
          // Lumpy (non-circular) silhouette from a few angular harmonics.
          const ang = Math.atan2(dy, dx);
          const R =
            rock.r *
            (1 +
              0.13 * Math.sin(3 * ang + noise1(rock.seed) * 6.283) +
              0.07 * Math.sin(5 * ang + noise1(rock.seed + 1) * 6.283) +
              0.045 * Math.sin(7 * ang + noise1(rock.seed + 2) * 6.283));
          if (d > R) continue;
          // Sphere height at this pixel → nearer surface wins the pixel.
          const zc = Math.sqrt(Math.max(0, 1 - (d / R) ** 2));
          const key = rock.depth + zc * rock.r;
          if (key <= front) continue;
          // Unit surface normal (nlx² + nly² + zc² == 1 by construction).
          const nlx = dx / R;
          const nly = dy / R;
          const lam = Math.max(0, nlx * L[0] + nly * L[1] + zc * L[2]);
          let v = 0.16 + 0.84 * lam; // ambient + diffuse
          v += (1 - zc) ** 2 * 0.18; // bright limb to lift the silhouette
          // Craters on the hero only: shaded bowls with a lit far rim.
          if (rock.r > 0.3) {
            for (let k = 0; k < 3; k++) {
              const cs = rock.seed * 7 + k * 13;
              const ca = noise1(cs) * 6.283;
              const cr = 0.15 + 0.5 * noise1(cs + 1);
              const ccx = Math.cos(ca) * cr;
              const ccy = Math.sin(ca) * cr;
              const crad = 0.12 + 0.12 * noise1(cs + 2);
              const cd = Math.hypot(nlx - ccx, nly - ccy);
              if (cd < crad) {
                const t = cd / crad; // 0 centre .. 1 rim
                v *= 0.6 + 0.4 * t; // darken toward the pit
                if (t > 0.85) v += 0.2 * (1 - (t - 0.9) / 0.1) ** 2; // rim
              }
            }
          }
          front = key;
          value = Math.max(0, Math.min(1, v));
          alpha = Math.max(0, Math.min(1, (R - d) / (1.5 * px)));
        }
        const o = (y * size + x) * 4;
        const g = Math.round(value * 255);
        img.data[o] = g;
        img.data[o + 1] = g;
        img.data[o + 2] = g;
        img.data[o + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A comet tail: a soft teardrop that fades along +x, so a sprite rotated by the
 * node hash streaks away from the head. Greyscale; the material tints it.
 */
export function cometTailTexture(size: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(size, size);
    const half = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x + 0.5 - half) / half; // -1..1 along the tail
        const ny = (y + 0.5 - half) / half;
        // Head at nx=-1, fading to nothing at nx=1; narrows toward the tip.
        const along = Math.max(0, Math.min(1, (nx + 1) / 2));
        const width = 0.5 * (1 - along) + 0.05;
        const across = Math.exp(-(ny * ny) / (2 * width * width));
        const a = across * (1 - along) ** 1.5;
        const o = (y * size + x) * 4;
        img.data[o] = 255;
        img.data[o + 1] = 255;
        img.data[o + 2] = 255;
        img.data[o + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
