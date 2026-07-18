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

/** Smooth 2D value noise on an integer lattice, hashed from `seed` (0..1). */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const h = (a: number, b: number) =>
    noise1(seed * 131.7 + a * 57.3 + b * 131.1);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * u;
  const b = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * u;
  return a + (b - a) * v;
}

/** Four-octave fbm (~0..1) for rocky surface grain and bump. */
function fbm(x: number, y: number, seed: number): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < 4; o++) {
    v += amp * valueNoise(x * freq, y * freq, seed + o * 13);
    amp *= 0.5;
    freq *= 2;
  }
  return v;
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
    // Light from the upper-left, more side-on than head-on (pre-normalised) so
    // the far side falls into a real terminator instead of an even pale wash.
    const L = [-0.62, -0.56, 0.55] as const;
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
              0.16 * Math.sin(3 * ang + noise1(rock.seed) * 6.283) +
              0.09 * Math.sin(5 * ang + noise1(rock.seed + 1) * 6.283) +
              0.06 * Math.sin(7 * ang + noise1(rock.seed + 2) * 6.283) +
              0.03 * Math.sin(11 * ang + noise1(rock.seed + 3) * 6.283));
          if (d > R) continue;
          // Sphere height at this pixel → nearer surface wins the pixel.
          const zc = Math.sqrt(Math.max(0, 1 - (d / R) ** 2));
          const key = rock.depth + zc * rock.r;
          if (key <= front) continue;
          // Unit surface normal (nlx² + nly² + zc² == 1 by construction).
          const nlx = dx / R;
          const nly = dy / R;
          // Bump mapping: perturb the normal by the slope of an fbm height field
          // so the lighting itself is rough (per-pixel micro-shadowing) — a matte
          // grainy rock, not a smooth glossy sphere. Finite-difference slope.
          const F = 7;
          const h0 = fbm(nlx * F + rock.seed, nly * F - rock.seed, rock.seed);
          const hx = fbm(
            (nlx + 0.03) * F + rock.seed,
            nly * F - rock.seed,
            rock.seed,
          );
          const hy = fbm(
            nlx * F + rock.seed,
            (nly + 0.03) * F - rock.seed,
            rock.seed,
          );
          const bump = 2.4;
          let Nx = nlx - (hx - h0) * bump;
          let Ny = nly - (hy - h0) * bump;
          let Nz = zc;
          const inv = 1 / Math.hypot(Nx, Ny, Nz);
          Nx *= inv;
          Ny *= inv;
          Nz *= inv;
          const lam = Math.max(0, Nx * L[0] + Ny * L[1] + Nz * L[2]);
          let v = 0.09 + 0.94 * lam; // low ambient + strong diffuse → dark side
          v += (1 - zc) ** 3 * 0.04; // whisper of limb, no gloss highlight
          v *= 0.74 + 0.36 * h0; // albedo grain — patchy stone, not uniform
          // Craters on the hero only: bowls with a directional inner-wall light —
          // the wall facing the sun brightens, the opposite wall shadows, which
          // reads as a depression instead of a printed ring.
          if (rock.r > 0.3) {
            for (let k = 0; k < 3; k++) {
              const cs = rock.seed * 7 + k * 13;
              const ca = noise1(cs) * 6.283;
              const cr = 0.15 + 0.5 * noise1(cs + 1);
              const ccx = Math.cos(ca) * cr;
              const ccy = Math.sin(ca) * cr;
              const crad = 0.12 + 0.12 * noise1(cs + 2);
              const dux = (nlx - ccx) / crad;
              const duy = (nly - ccy) / crad;
              const t = Math.hypot(dux, duy); // 0 centre .. 1 rim
              if (t < 1) {
                v *= 0.5 + 0.5 * t * t; // dark floor, back to surface at the rim
                // Inner-wall normal ≈ -(dux, duy); brighten the sun-facing wall.
                const wall = -(dux * L[0] + duy * L[1]);
                if (t > 0.55) v += ((t - 0.55) / 0.45) * wall * 0.5;
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
 * A warlord black hole's accretion disc: a hot annulus with a cleared hole in
 * the middle (where the dark core sprite sits), computed per-pixel and dither-
 * free. Colour is baked — a white-hot inner edge grading through orange to a
 * deep-red outer rim — so a plane laid flat in the galaxy plane foreshortens
 * into an ellipse under the tilted camera, no screen-space lensing needed.
 */
export function accretionTexture(size: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(size, size);
    const half = size / 2;
    // White-hot inner -> orange mid -> deep-red outer, lerped by band radius.
    const inner = [255, 244, 214] as const;
    const mid = [255, 154, 60] as const;
    const outer = [176, 52, 20] as const;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
        // A gaussian band centred at ~0.52, with the hole cleared below ~0.2.
        const band = Math.exp(-((d - 0.52) ** 2) / (2 * 0.15 * 0.15));
        const hole = Math.min(1, Math.max(0, (d - 0.2) / 0.1));
        const a = Math.min(1, band * hole);
        const t = Math.min(1, Math.max(0, (d - 0.34) / 0.4)); // 0 inner..1 outer
        const seg = t < 0.5 ? t * 2 : (t - 0.5) * 2;
        const lo = t < 0.5 ? inner : mid;
        const hi = t < 0.5 ? mid : outer;
        const o = (y * size + x) * 4;
        for (let c = 0; c < 3; c++) {
          img.data[o + c] = Math.round(lo[c] + (hi[c] - lo[c]) * seg);
        }
        img.data[o + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * An orbital station: a geometric, artificial silhouette — a central hab core,
 * a docking ring on radial spokes, and two solar-panel wings — so it reads as
 * *built structure*, not a fuzzy star. Drawn with solid fills/strokes (no
 * gradients, so no WebKit dither) in greyscale; the sprite material supplies the
 * metallic tint, with a couple of near-white window specks catching the light.
 */
export function stationTexture(size: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    const m = size / 2;
    // Solar-panel wings: dark framed rectangles reaching past the ring, drawn
    // first so the hub structure overlaps them.
    ctx.fillStyle = "rgb(70,70,74)";
    ctx.strokeStyle = "rgb(150,150,156)";
    ctx.lineWidth = size * 0.012;
    for (const dir of [-1, 1]) {
      const px = m + dir * size * 0.34;
      ctx.fillRect(
        px - size * 0.11,
        m - size * 0.075,
        size * 0.22,
        size * 0.15,
      );
      ctx.strokeRect(
        px - size * 0.11,
        m - size * 0.075,
        size * 0.22,
        size * 0.15,
      );
      // Cell divisions.
      for (let k = 1; k < 3; k++) {
        const x = px - size * 0.11 + (size * 0.22 * k) / 3;
        ctx.beginPath();
        ctx.moveTo(x, m - size * 0.075);
        ctx.lineTo(x, m + size * 0.075);
        ctx.stroke();
      }
    }
    // Radial spokes from the hub out to the docking ring.
    ctx.strokeStyle = "rgb(120,122,128)";
    ctx.lineWidth = size * 0.03;
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(m + Math.cos(a) * size * 0.12, m + Math.sin(a) * size * 0.12);
      ctx.lineTo(m + Math.cos(a) * size * 0.4, m + Math.sin(a) * size * 0.4);
      ctx.stroke();
    }
    // Docking ring.
    ctx.strokeStyle = "rgb(200,203,210)";
    ctx.lineWidth = size * 0.075;
    ctx.beginPath();
    ctx.arc(m, m, size * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    // Central hab core.
    ctx.fillStyle = "rgb(176,179,184)";
    ctx.beginPath();
    ctx.arc(m, m, size * 0.16, 0, Math.PI * 2);
    ctx.fill();
    // Window lights catching the sun.
    ctx.fillStyle = "rgb(255,252,240)";
    for (const [wx, wy] of [
      [-0.05, -0.04],
      [0.04, 0.02],
      [-0.01, 0.06],
    ] as const) {
      ctx.beginPath();
      ctx.arc(m + wx * size, m + wy * size, size * 0.018, 0, Math.PI * 2);
      ctx.fill();
    }
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
        // Head at nx=-1, tip at nx=+1; narrows toward the tip.
        const along = Math.max(0, Math.min(1, (nx + 1) / 2));
        // Narrow so the cross-section reaches ~0 at the sprite's vertical edges
        // (a wide head read as a hard band under additive blending).
        const width = 0.16 * (1 - along) + 0.025;
        const across = Math.exp(-(ny * ny) / (2 * width * width));
        // Fade both ENDS to zero: a short ramp-in at the head so the bright end
        // doesn't hit the texture boundary as a hard terminator, and a gentle
        // taper to nothing at the tip so the streak stays legible.
        const headFade = Math.min(1, along / 0.09);
        const a = across * headFade * (1 - along) ** 1.05;
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
