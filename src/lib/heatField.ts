/**
 * A density field over a map: where points fall, added up (issue #1151).
 *
 * Arithmetic on plain values with no three.js and no DOM, so it can be tested
 * with numbers and so several fields can be added together before anything is
 * coloured. Colouring is `heatRamp.ts`, drawing on the 3D map is
 * `heatmapLayer.ts`.
 *
 * Every position is in engine world units (elmos), measured from the map's
 * north-west corner: x grows east and z grows south, as a replay records them.
 * Row 0 of a field is the map's north edge and column 0 its west edge.
 *
 * The method is demonaut's. Each point adds a soft round blob to the field, the
 * blobs sum, and the field is later read relative to its own brightest cell.
 * The blob is a Gaussian, so the sum is done as two passes over the grid and
 * not once per point. The cost then depends on the grid and hardly at all on
 * how many points there are.
 */

/**
 * Points to add up. Flat arrays and not a list of objects, because a full
 * match is tens of thousands of orders.
 *
 * Hold one of these in a ref or a memo. Do not spread its arrays into React
 * props: the development build walks a typed array prop key by key.
 */
export interface HeatPoints {
  /** `x0, z0, x1, z1, ...` in elmos. */
  positions: ArrayLike<number>;
  /** One weight per point. Left out, every point counts as 1. */
  weights?: ArrayLike<number>;
}

/** Build {@link HeatPoints} from a list, for a caller that has objects. */
export function heatPoints(
  list: readonly { x: number; z: number; weight?: number }[],
): HeatPoints {
  const positions = new Float32Array(list.length * 2);
  const weights = new Float32Array(list.length);
  list.forEach((point, i) => {
    positions[i * 2] = point.x;
    positions[i * 2 + 1] = point.z;
    weights[i] = point.weight ?? 1;
  });
  return { positions, weights };
}

export interface HeatFieldOptions {
  /**
   * How far one point's influence reaches, in elmos. Past this distance a
   * point adds nothing.
   *
   * A statement about the game world, so it is never a pixel count. The
   * default is {@link DEFAULT_RADIUS_FRACTION} of the map's shorter side. A
   * caller that knows what its events are should pass its own.
   */
  radius?: number;
  /** Cells along the map's longer side. Default {@link DEFAULT_RESOLUTION}. */
  resolution?: number;
}

/**
 * The default reach of one point, as a fraction of the map's shorter side.
 *
 * A fraction, so the picture has the same grain on a small map and a large
 * one. The value is a display choice with no measurement behind it: at 1/32 an
 * opening's buildings merge into one patch per base and two bases stay apart.
 */
export const DEFAULT_RADIUS_FRACTION = 1 / 32;

/**
 * Cells along the longer side by default. The shorter side is scaled to the
 * map's shape, so a cell is as near square as whole numbers allow.
 *
 * At 256 the default radius is 8 cells on a square map, which is enough for a
 * blob to be round.
 *
 * Timed on one machine, an Apple silicon Mac, in bun, which runs the same
 * JavaScript engine as the app's webview on macOS. Synthetic points clustered
 * round ten bases, mean of 50 builds. On a 256 by 128 grid: 1.05 ms for 3,605
 * points and 2.6 ms for 90,000. On a 256 by 256 grid: 4.3 ms for 90,000.
 * Colouring a 256 by 128 field took 1.3 ms. All under one 16.7 ms frame at
 * 60 Hz, so a time window (#1153) can rebuild on every drag step.
 */
export const DEFAULT_RESOLUTION = 256;

/** The blob's standard deviation as a fraction of the radius. At 2.5 standard
 *  deviations a Gaussian is under 5% of its centre, so cutting it there loses
 *  nothing that would be drawn. */
const SIGMA_PER_RADIUS = 1 / 2.5;

export interface HeatField {
  /** Cells across (west to east) and down (north to south). */
  width: number;
  height: number;
  worldWidth: number;
  worldHeight: number;
  /** The reach each point was given, in elmos. */
  radius: number;
  /** The largest value in the field. 0 for a field with nothing in it. */
  peak: number;
  /** The middle of the brightest cell, in elmos. Null for an empty field. */
  peakAt: { x: number; z: number } | null;
  /**
   * The summed weight of the points within `radius` of `peakAt`. This is the
   * number a legend can state in words: so many orders within so many elmos.
   * Absent on a field made by {@link addHeatFields}, which has no points.
   */
  peakWithinRadius?: number;
  /** How many points went in. */
  counted: number;
  /** How many were left out for being off the map or not a number. */
  dropped: number;
  /**
   * Row-major, `width * height` values. Not enumerable, so a field can travel
   * as a React prop without the development build walking every cell.
   */
  values: Float32Array;
}

function makeField(
  shape: Omit<HeatField, "values">,
  values: Float32Array,
): HeatField {
  const field = { ...shape } as HeatField;
  Object.defineProperty(field, "values", { value: values, enumerable: false });
  return field;
}

/** The grid a map of this shape gets. */
export function heatGridSize(
  worldWidth: number,
  worldHeight: number,
  resolution = DEFAULT_RESOLUTION,
): { width: number; height: number } {
  const longest = Math.max(worldWidth, worldHeight);
  const cells = Math.max(1, Math.round(resolution));
  if (!(longest > 0)) return { width: 1, height: 1 };
  return {
    width: Math.max(1, Math.round((cells * worldWidth) / longest)),
    height: Math.max(1, Math.round((cells * worldHeight) / longest)),
  };
}

/** One pass of the blur along a row or a column. `step` is 1 for a row and
 *  the grid's width for a column. */
function blurLines(
  from: Float32Array,
  into: Float32Array,
  lines: number,
  length: number,
  lineStep: number,
  step: number,
  kernel: Float32Array,
) {
  const reach = (kernel.length - 1) / 2;
  for (let line = 0; line < lines; line++) {
    const base = line * lineStep;
    for (let i = 0; i < length; i++) {
      let sum = 0;
      const lo = Math.max(0, i - reach);
      const hi = Math.min(length - 1, i + reach);
      for (let j = lo; j <= hi; j++)
        sum += from[base + j * step] * kernel[j - i + reach];
      into[base + i * step] = sum;
    }
  }
}

/** A Gaussian cut off at `reachCells`, with 1 at its centre. */
function kernelFor(sigmaCells: number, reachCells: number): Float32Array {
  const reach = Math.max(0, Math.ceil(reachCells));
  const kernel = new Float32Array(reach * 2 + 1);
  for (let i = -reach; i <= reach; i++)
    kernel[i + reach] =
      sigmaCells > 0 ? Math.exp(-(i * i) / (2 * sigmaCells * sigmaCells)) : 1;
  return kernel;
}

/**
 * Spread each cell of a binned grid into the soft round blob, and find the
 * brightest cell. `binned` and `into` may be the same array.
 */
function smooth(
  binned: Float32Array,
  into: Float32Array,
  shape: {
    width: number;
    height: number;
    worldWidth: number;
    worldHeight: number;
    radius: number;
  },
): { peak: number; peakAt: { x: number; z: number } | null } {
  const { width, height, radius } = shape;
  const cellW = shape.worldWidth / width;
  const cellH = shape.worldHeight / height;
  const sigma = radius * SIGMA_PER_RADIUS;
  const across = new Float32Array(width * height);
  blurLines(
    binned,
    across,
    height,
    width,
    width,
    1,
    kernelFor(sigma / cellW, radius / cellW),
  );
  blurLines(
    across,
    into,
    width,
    height,
    1,
    width,
    kernelFor(sigma / cellH, radius / cellH),
  );
  let peak = 0;
  let peakIndex = -1;
  for (let i = 0; i < into.length; i++) {
    if (into[i] > peak) {
      peak = into[i];
      peakIndex = i;
    }
  }
  return {
    peak,
    peakAt:
      peakIndex < 0
        ? null
        : {
            x: ((peakIndex % width) + 0.5) * cellW,
            z: (Math.floor(peakIndex / width) + 0.5) * cellH,
          },
  };
}

/**
 * Add points up into a field.
 *
 * A point off the map, or one that is not a number, is left out and counted in
 * `dropped`. It is not moved to the edge, because a pile of clamped points
 * would draw a hotspot on the border that no event happened at.
 *
 * No points gives an empty field and does no work.
 */
export function buildHeatField(
  points: HeatPoints,
  map: { worldWidth: number; worldHeight: number },
  options: HeatFieldOptions = {},
): HeatField {
  const { worldWidth, worldHeight } = map;
  const { width, height } = heatGridSize(
    worldWidth,
    worldHeight,
    options.resolution,
  );
  const radius =
    options.radius ??
    Math.min(worldWidth, worldHeight) * DEFAULT_RADIUS_FRACTION;
  const total = Math.floor(points.positions.length / 2);
  const shape = {
    width,
    height,
    worldWidth,
    worldHeight,
    radius,
    peak: 0,
    peakAt: null,
    counted: 0,
    dropped: total,
  };
  if (total === 0 || !(worldWidth > 0) || !(worldHeight > 0))
    return makeField(shape, new Float32Array(width * height));

  const cellW = worldWidth / width;
  const cellH = worldHeight / height;
  const binned = new Float32Array(width * height);
  let counted = 0;
  for (let i = 0; i < total; i++) {
    const x = points.positions[i * 2];
    const z = points.positions[i * 2 + 1];
    const weight = points.weights ? points.weights[i] : 1;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(z) ||
      !Number.isFinite(weight) ||
      x < 0 ||
      z < 0 ||
      x > worldWidth ||
      z > worldHeight
    )
      continue;
    counted++;
    // Shared between the four nearest cell centres, so a point keeps its place
    // to better than a cell. At an edge the outer share folds back in.
    const gx = x / cellW - 0.5;
    const gz = z / cellH - 0.5;
    const col = Math.floor(gx);
    const row = Math.floor(gz);
    const fx = gx - col;
    const fz = gz - row;
    const c0 = Math.min(width - 1, Math.max(0, col));
    const c1 = Math.min(width - 1, Math.max(0, col + 1));
    const r0 = Math.min(height - 1, Math.max(0, row));
    const r1 = Math.min(height - 1, Math.max(0, row + 1));
    binned[r0 * width + c0] += weight * (1 - fx) * (1 - fz);
    binned[r0 * width + c1] += weight * fx * (1 - fz);
    binned[r1 * width + c0] += weight * (1 - fx) * fz;
    binned[r1 * width + c1] += weight * fx * fz;
  }
  if (counted === 0) return makeField(shape, binned);

  // The blur writes back into the binned grid, which nothing reads after it.
  const { peak, peakAt } = smooth(binned, binned, shape);
  const values = binned;
  let peakWithinRadius = 0;
  if (peakAt) {
    for (let i = 0; i < total; i++) {
      const x = points.positions[i * 2];
      const z = points.positions[i * 2 + 1];
      const weight = points.weights ? points.weights[i] : 1;
      if (!Number.isFinite(weight)) continue;
      if (x < 0 || z < 0 || x > worldWidth || z > worldHeight) continue;
      if (Math.hypot(x - peakAt.x, z - peakAt.z) <= radius)
        peakWithinRadius += weight;
    }
  }
  return makeField(
    {
      ...shape,
      peak,
      peakAt,
      peakWithinRadius,
      counted,
      dropped: total - counted,
    },
    values,
  );
}

/**
 * A field from counts that are already on the map's grid: `binned[row * width
 * + column]` is how much fell in that cell. Each cell's amount is taken to sit
 * at the cell's middle.
 *
 * For counts made somewhere other than here. A replay's events are counted in
 * Rust on this same grid (`map_grids.rs`), and many replays' counts are added
 * before this smooths the sum once. The blob is linear, so smoothing a sum is
 * the same as adding smoothed fields, and costs one pass and not one a replay.
 *
 * It differs from {@link buildHeatField} over the same events by where in a
 * cell an event is put: there at its own place, shared between the four
 * nearest cell middles, and here at the middle of its cell. That moves an
 * event by half a cell at most.
 *
 * `binned` is left as it was. `counted` is what the field reports as how many
 * events went in, and left out it is the sum of the grid.
 */
export function buildHeatFieldFromCounts(
  binned: Float32Array,
  map: { worldWidth: number; worldHeight: number },
  options: HeatFieldOptions & { counted?: number } = {},
): HeatField {
  const { worldWidth, worldHeight } = map;
  const { width, height } = heatGridSize(
    worldWidth,
    worldHeight,
    options.resolution,
  );
  if (binned.length !== width * height)
    throw new Error("counts are not on this map's grid");
  const radius =
    options.radius ??
    Math.min(worldWidth, worldHeight) * DEFAULT_RADIUS_FRACTION;
  let sum = 0;
  for (let i = 0; i < binned.length; i++) sum += binned[i];
  const shape = {
    width,
    height,
    worldWidth,
    worldHeight,
    radius,
    peak: 0,
    peakAt: null,
    counted: options.counted ?? sum,
    dropped: 0,
  };
  const values = new Float32Array(width * height);
  if (!(sum > 0) || !(worldWidth > 0) || !(worldHeight > 0))
    return makeField(shape, values);
  const { peak, peakAt } = smooth(binned, values, shape);
  const cellW = worldWidth / width;
  const cellH = worldHeight / height;
  let peakWithinRadius = 0;
  if (peakAt) {
    for (let row = 0; row < height; row++) {
      const dz = (row + 0.5) * cellH - peakAt.z;
      for (let col = 0; col < width; col++) {
        const amount = binned[row * width + col];
        if (amount === 0) continue;
        if (Math.hypot((col + 0.5) * cellW - peakAt.x, dz) <= radius)
          peakWithinRadius += amount;
      }
    }
  }
  return makeField({ ...shape, peak, peakAt, peakWithinRadius }, values);
}

/**
 * Several fields of one map added into one, each scaled first.
 *
 * For a picture of many replays. Pass `1 / field.peak`, or one over a match's
 * order count, as a field's scale so a long match does not drown the short
 * ones. The fields must share a grid, which they do when they were built for
 * the same map with the same resolution.
 */
export function addHeatFields(
  fields: readonly HeatField[],
  scales?: readonly number[],
): HeatField | null {
  const first = fields[0];
  if (!first) return null;
  const values = new Float32Array(first.width * first.height);
  let counted = 0;
  let dropped = 0;
  fields.forEach((field, at) => {
    if (field.width !== first.width || field.height !== first.height)
      throw new Error("heat fields of different grids cannot be added");
    const scale = scales?.[at] ?? 1;
    counted += field.counted;
    dropped += field.dropped;
    for (let i = 0; i < values.length; i++)
      values[i] += field.values[i] * scale;
  });
  let peak = 0;
  let peakIndex = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > peak) {
      peak = values[i];
      peakIndex = i;
    }
  }
  const cellW = first.worldWidth / first.width;
  const cellH = first.worldHeight / first.height;
  return makeField(
    {
      width: first.width,
      height: first.height,
      worldWidth: first.worldWidth,
      worldHeight: first.worldHeight,
      radius: first.radius,
      peak,
      peakAt:
        peakIndex < 0
          ? null
          : {
              x: ((peakIndex % first.width) + 0.5) * cellW,
              z: (Math.floor(peakIndex / first.width) + 0.5) * cellH,
            },
      counted,
      dropped,
    },
    values,
  );
}

/** The field's value at a world position, read from the cell it falls in. 0
 *  off the map. */
export function heatAt(field: HeatField, x: number, z: number): number {
  if (x < 0 || z < 0 || x > field.worldWidth || z > field.worldHeight) return 0;
  const col = Math.min(
    field.width - 1,
    Math.floor((x / field.worldWidth) * field.width),
  );
  const row = Math.min(
    field.height - 1,
    Math.floor((z / field.worldHeight) * field.height),
  );
  return field.values[row * field.width + col];
}
