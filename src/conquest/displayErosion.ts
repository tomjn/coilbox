import { hashString, mulberry32 } from "./rng";

/**
 * A display-only erosion pass for generated land. The strategic view lights
 * the ground from a height field, and this makes a second one with gullies
 * running downhill into valleys. It is never the ground: roads, provinces,
 * towns and the heights the links are routed on all keep the pinned
 * heightmap, and `terrainGolden.test.ts` never sees this.
 *
 * Droplets run downhill on a half resolution copy. Each keeps some of its
 * direction (inertia), takes material where it speeds up and drops it where it
 * slows. What they changed is split into cuts and deposits. Cuts are blurred a
 * little so they stay crisp and deposits more so they spread into fans, and
 * the sum, less its own wide blur so only fine detail is left, is added back
 * to the full resolution heights.
 */

/** Drops per half resolution cell. */
const DROPS_PER_CELL = 1.5;
/** Steps a drop lives for, if it does not reach the sea or the edge first. */
const STEPS = 50;
/** Drops simulated together, as arrays, before the next batch sees their work. */
const BATCH = 4096;
/** How much of its last direction a drop keeps. */
const INERTIA = 0.4;
/** How much a fall speeds a drop up. */
const GRAVITY = 4;
/** Share of a drop's water lost each step. */
const EVAPORATION = 0.01;
/** How much a drop can carry for its speed, water and slope. */
const CAPACITY = 4;
/** Slope floor, so a drop on near flat ground still carries a little. */
const MIN_SLOPE = 0.002;
/** Share of the room under its capacity a drop fills each step. */
const ERODE_RATE = 0.3;
/** Share of the load over its capacity a drop sets down each step. */
const DEPOSIT_RATE = 0.3;
/** Blur radii in half resolution pixels. */
const CUT_BLUR = 1;
const CUT_PASSES = 1;
const DEPOSIT_BLUR = 3;
const DEPOSIT_PASSES = 2;
/** The blur whose result is taken back out, so only fine detail is left. */
const BROAD_BLUR = 6;
const BROAD_PASSES = 2;

/** `src` through `passes` box blurs of `radius` pixels, edge pixels repeated. */
function blur(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  passes: number,
): Float32Array {
  const rows = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const scale = 1 / (2 * radius + 1);
  const line = (
    from: Float32Array,
    to: Float32Array,
    offset: number,
    stride: number,
    n: number,
  ) => {
    const at = (i: number) =>
      from[offset + Math.min(n - 1, Math.max(0, i)) * stride];
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += at(k);
    for (let i = 0; i < n; i++) {
      to[offset + i * stride] = sum * scale;
      sum += at(i + radius + 1) - at(i - radius);
    }
  };
  let from = src;
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++) line(from, rows, y * width, 1, width);
    for (let x = 0; x < width; x++) line(rows, out, x, width, height);
    from = out;
  }
  return out;
}

/** Drops run over `h` in place. `h` is `width` by `height`, heights 0 to 1. */
function runDrops(
  h: Float32Array,
  width: number,
  height: number,
  rng: () => number,
): void {
  const total = Math.floor(width * height * DROPS_PER_CELL);
  const px = new Float64Array(BATCH);
  const py = new Float64Array(BATCH);
  const dx = new Float64Array(BATCH);
  const dy = new Float64Array(BATCH);
  const speed = new Float64Array(BATCH);
  const water = new Float64Array(BATCH);
  const sediment = new Float64Array(BATCH);
  const alive = new Uint8Array(BATCH);
  for (let first = 0; first < total; first += BATCH) {
    const n = Math.min(BATCH, total - first);
    for (let d = 0; d < n; d++) {
      px[d] = rng() * (width - 1.001);
      py[d] = rng() * (height - 1.001);
      dx[d] = 0;
      dy[d] = 0;
      speed[d] = 1;
      water[d] = 1;
      sediment[d] = 0;
      // A drop that starts in the sea has nothing to run down.
      const ix = Math.floor(px[d]);
      const iy = Math.floor(py[d]);
      alive[d] = h[iy * width + ix] > 0 ? 1 : 0;
    }
    for (let step = 0; step < STEPS; step++) {
      for (let d = 0; d < n; d++) {
        if (!alive[d]) continue;
        const x = px[d];
        const y = py[d];
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = x - ix;
        const fy = y - iy;
        const i = iy * width + ix;
        const h00 = h[i];
        const h10 = h[i + 1];
        const h01 = h[i + width];
        const h11 = h[i + width + 1];
        const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
        const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
        const heightHere =
          h00 * (1 - fx) * (1 - fy) +
          h10 * fx * (1 - fy) +
          h01 * (1 - fx) * fy +
          h11 * fx * fy;

        let ndx = dx[d] * INERTIA - gx * (1 - INERTIA);
        let ndy = dy[d] * INERTIA - gy * (1 - INERTIA);
        let length = Math.sqrt(ndx * ndx + ndy * ndy);
        if (length < 1e-12) {
          // On a flat or a peak: pick a way, so the drop still leaves.
          const angle = rng() * Math.PI * 2;
          ndx = Math.cos(angle);
          ndy = Math.sin(angle);
          length = 1;
        }
        ndx /= length;
        ndy /= length;
        dx[d] = ndx;
        dy[d] = ndy;
        const nx = x + ndx;
        const ny = y + ndy;
        if (nx < 0 || ny < 0 || nx >= width - 1 || ny >= height - 1) {
          alive[d] = 0;
          continue;
        }
        const jx = Math.floor(nx);
        const jy = Math.floor(ny);
        const gxn = nx - jx;
        const gyn = ny - jy;
        const j = jy * width + jx;
        const heightThere =
          h[j] * (1 - gxn) * (1 - gyn) +
          h[j + 1] * gxn * (1 - gyn) +
          h[j + width] * (1 - gxn) * gyn +
          h[j + width + 1] * gxn * gyn;
        const delta = heightThere - heightHere;
        const capacity =
          Math.max(-delta, MIN_SLOPE) * speed[d] * water[d] * CAPACITY;

        // Four corners of the cell the drop is leaving take the change.
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        if (sediment[d] > capacity || delta > 0) {
          const dropped =
            delta > 0
              ? Math.min(delta, sediment[d])
              : (sediment[d] - capacity) * DEPOSIT_RATE;
          sediment[d] -= dropped;
          h[i] += dropped * w00;
          h[i + 1] += dropped * w10;
          h[i + width] += dropped * w01;
          h[i + width + 1] += dropped * w11;
        } else {
          const taken = Math.min((capacity - sediment[d]) * ERODE_RATE, -delta);
          sediment[d] += taken;
          // Never cut into the sea or below it. The shore stays where it is.
          h[i] = Math.max(0, h[i] - taken * w00);
          h[i + 1] = Math.max(0, h[i + 1] - taken * w10);
          h[i + width] = Math.max(0, h[i + width] - taken * w01);
          h[i + width + 1] = Math.max(0, h[i + width + 1] - taken * w11);
        }
        speed[d] = Math.sqrt(
          Math.max(0, speed[d] * speed[d] - delta * GRAVITY),
        );
        water[d] *= 1 - EVAPORATION;
        px[d] = nx;
        py[d] = ny;
        // Reached the sea: the drop's load goes with it.
        if (heightThere <= 0) alive[d] = 0;
      }
    }
  }
}

/**
 * `relief` with gullies and valleys carved in, for shading only. `relief` is
 * `width` by `height` heights from 0 to 1 and is left alone. Zero stays zero,
 * so the sea and the shore do not move. The same heights and seed always give
 * the same answer.
 */
export function erodeRelief(
  relief: Float32Array,
  width: number,
  height: number,
  seed: number,
): Float32Array {
  const hw = Math.ceil(width / 2);
  const hh = Math.ceil(height / 2);
  if (hw < 3 || hh < 3) return relief.slice();

  // Half resolution copy: each cell is the mean of the pixels it covers. A
  // cell that covers any sea counts as sea, so a drop never carves the shore.
  const half = new Float32Array(hw * hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      let sum = 0;
      let count = 0;
      let sea = false;
      for (let oy = 0; oy < 2; oy++) {
        for (let ox = 0; ox < 2; ox++) {
          const sx = Math.min(width - 1, x * 2 + ox);
          const sy = Math.min(height - 1, y * 2 + oy);
          const v = relief[sy * width + sx];
          if (v <= 0) sea = true;
          sum += v;
          count++;
        }
      }
      half[y * hw + x] = sea ? 0 : sum / count;
    }
  }

  const eroded = half.slice();
  runDrops(eroded, hw, hh, mulberry32(hashString(`erosion:${seed >>> 0}`)));

  const cuts = new Float32Array(half.length);
  const deposits = new Float32Array(half.length);
  for (let i = 0; i < half.length; i++) {
    const diff = eroded[i] - half[i];
    if (diff < 0) cuts[i] = -diff;
    else deposits[i] = diff;
  }
  const cut = blur(cuts, hw, hh, CUT_BLUR, CUT_PASSES);
  const spread = blur(deposits, hw, hh, DEPOSIT_BLUR, DEPOSIT_PASSES);
  const change = new Float32Array(half.length);
  for (let i = 0; i < change.length; i++) change[i] = spread[i] - cut[i];
  // Only the fine part stays. Mass the drops moved over a wide area would
  // change the shape of whole hills, which belongs to the pinned heightmap.
  const broad = blur(change, hw, hh, BROAD_BLUR, BROAD_PASSES);
  for (let i = 0; i < change.length; i++) change[i] -= broad[i];

  // Back up to full resolution, bilinear between half resolution cell centres.
  const out = new Float32Array(relief.length);
  for (let y = 0; y < height; y++) {
    const cy = Math.min(hh - 1, Math.max(0, (y - 0.5) / 2));
    const y0 = Math.min(hh - 2, Math.floor(cy));
    const fy = cy - y0;
    for (let x = 0; x < width; x++) {
      const o = y * width + x;
      const was = relief[o];
      if (was <= 0) continue;
      const cx = Math.min(hw - 1, Math.max(0, (x - 0.5) / 2));
      const x0 = Math.min(hw - 2, Math.floor(cx));
      const fx = cx - x0;
      const a = y0 * hw + x0;
      const top = change[a] + (change[a + 1] - change[a]) * fx;
      const bottom =
        change[a + hw] + (change[a + hw + 1] - change[a + hw]) * fx;
      const moved = top + (bottom - top) * fy;
      out[o] = Math.min(1, Math.max(0, was + moved));
    }
  }
  return out;
}
