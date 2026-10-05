import type { HeightGrid } from "./terrain";

/**
 * Where a road runs on the ground. A road between two locations is routed as
 * the cheapest path over the heightmap: climbing costs, steep ground costs a
 * great deal more, and water costs most of all. The path is then smoothed so
 * it curves like a worn track instead of stepping from cell to cell.
 *
 * Display only. The route changes nothing in play, and it is worked out from
 * the map document alone, so the same map always draws the same roads. Pure,
 * so it is tested without a scene.
 */

/** A position in map units. */
export type MapXY = [number, number];

/**
 * The grid roads are routed over. Each cell holds the ground height, 0 to 1,
 * at a point of the map, laid out like a {@link HeightGrid}: cell `i, j` is at
 * map `i / (cols - 1) * mapWidth, j / (rows - 1) * mapHeight`.
 */
export interface RouteGrid {
  cols: number;
  rows: number;
  /** Map units per cell along x and y. */
  stepX: number;
  stepY: number;
  /** Height of a white heightmap pixel in map units. */
  heightScale: number;
  height: Float32Array;
  /** A small seeded field from 0 to 1 that makes a route wander. */
  wander: Float32Array;
}

/** No more cells than this along the grid's longer side, to keep routing fast. */
export const ROUTE_MAX_CELLS = 512;
/** Cells along the longer side of a map with no heightmap. */
const FLAT_CELLS = 128;
/** A height below this, out of 1, is sea: the generator's sea is exactly 0. */
export const SEA_LEVEL = 0.5 / 255;

/**
 * Design values for the cost of a step. A step costs its length times
 * `1 + GRADE_WEIGHT * grade² + HEIGHT_WEIGHT * height + WANDER * wander`,
 * and a step into the sea costs {@link WATER_COST} times its length. Water is
 * dear and never forbidden, so a hand-made map whose low ground reads as sea
 * still gets its roads.
 */
const GRADE_WEIGHT = 40;
const HEIGHT_WEIGHT = 0.6;
const WANDER = 0.45;
const WATER_COST = 60;
/** Cells across one bump of the wander field. */
const WANDER_CELLS = 14;

/** A 32 bit integer hash of two cell coordinates and a seed. */
function hash3(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Smooth value noise from 0 to 1 with a bump every `size` cells. */
function valueNoise(
  cols: number,
  rows: number,
  size: number,
  seed: number,
): Float32Array {
  const out = new Float32Array(cols * rows);
  const at = (x: number, y: number) => hash3(x, y, seed) / 0xffffffff;
  for (let j = 0; j < rows; j++) {
    const gy = j / size;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    const sy = fy * fy * (3 - 2 * fy);
    for (let i = 0; i < cols; i++) {
      const gx = i / size;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const sx = fx * fx * (3 - 2 * fx);
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const bottom =
        at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      out[j * cols + i] = top + (bottom - top) * sy;
    }
  }
  return out;
}

/**
 * The routing grid for a map `mapWidth` by `mapHeight` map units. `heights`
 * may be left out for a flat map. A heightmap finer than
 * {@link ROUTE_MAX_CELLS} is read at that many cells, blending its pixels.
 */
export function routeGrid(
  mapWidth: number,
  mapHeight: number,
  heightScale: number,
  seed: number,
  heights?: HeightGrid,
): RouteGrid {
  const long = Math.max(mapWidth, mapHeight);
  const along = heights
    ? Math.min(ROUTE_MAX_CELLS, Math.max(heights.width, heights.height))
    : FLAT_CELLS;
  const cols = Math.max(2, Math.round((along * mapWidth) / long));
  const rows = Math.max(2, Math.round((along * mapHeight) / long));
  const height = new Float32Array(cols * rows);
  if (heights) {
    const { data, width: w, height: h } = heights;
    for (let j = 0; j < rows; j++) {
      const y = (j / (rows - 1)) * (h - 1);
      const y0 = Math.floor(y);
      const y1 = Math.min(h - 1, y0 + 1);
      const fy = y - y0;
      for (let i = 0; i < cols; i++) {
        const x = (i / (cols - 1)) * (w - 1);
        const x0 = Math.floor(x);
        const x1 = Math.min(w - 1, x0 + 1);
        const fx = x - x0;
        const top =
          data[y0 * w + x0] + (data[y0 * w + x1] - data[y0 * w + x0]) * fx;
        const bottom =
          data[y1 * w + x0] + (data[y1 * w + x1] - data[y1 * w + x0]) * fx;
        height[j * cols + i] = top + (bottom - top) * fy;
      }
    }
  }
  return {
    cols,
    rows,
    stepX: mapWidth / (cols - 1),
    stepY: mapHeight / (rows - 1),
    heightScale,
    height,
    wander: valueNoise(cols, rows, WANDER_CELLS, seed),
  };
}

/** A binary heap of cell indices ordered by a cost, cheapest first. */
class CellHeap {
  readonly cells: number[] = [];
  readonly keys: number[] = [];
  get size(): number {
    return this.cells.length;
  }
  push(cell: number, key: number): void {
    const { cells, keys } = this;
    let i = cells.length;
    cells.push(cell);
    keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      cells[i] = cells[parent];
      keys[i] = keys[parent];
      i = parent;
    }
    cells[i] = cell;
    keys[i] = key;
  }
  pop(): number {
    const { cells, keys } = this;
    const top = cells[0];
    const lastCell = cells.pop() as number;
    const lastKey = keys.pop() as number;
    const n = cells.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        cells[i] = cells[c];
        keys[i] = keys[c];
        i = c;
      }
      cells[i] = lastCell;
      keys[i] = lastKey;
    }
    return top;
  }
}

const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** The cell nearest a map position, clamped to the grid. */
function cellAt(grid: RouteGrid, [x, y]: MapXY): number {
  const i = Math.min(grid.cols - 1, Math.max(0, Math.round(x / grid.stepX)));
  const j = Math.min(grid.rows - 1, Math.max(0, Math.round(y / grid.stepY)));
  return j * grid.cols + i;
}

/** The cost of one step between two neighbouring cells. */
export function stepCost(grid: RouteGrid, from: number, to: number): number {
  const { cols, stepX, stepY, height, wander, heightScale } = grid;
  const dx = ((to % cols) - (from % cols)) * stepX;
  const dy = (Math.floor(to / cols) - Math.floor(from / cols)) * stepY;
  const run = Math.sqrt(dx * dx + dy * dy);
  const h = height[to];
  if (h < SEA_LEVEL) return run * WATER_COST;
  const grade = (Math.abs(h - height[from]) * heightScale) / run;
  return (
    run *
    (1 + GRADE_WEIGHT * grade * grade + HEIGHT_WEIGHT * h + WANDER * wander[to])
  );
}

/**
 * The cheapest chain of cells from one map position to another, as the cells'
 * map positions, first cell to last. Every step costs at least its length, so
 * the straight distance is a true lower bound and the path is the cheapest.
 */
export function cheapestCells(
  grid: RouteGrid,
  from: MapXY,
  to: MapXY,
): MapXY[] {
  const { cols, rows, stepX, stepY } = grid;
  const start = cellAt(grid, from);
  const goal = cellAt(grid, to);
  const gx = (goal % cols) * stepX;
  const gy = Math.floor(goal / cols) * stepY;
  const best = new Float64Array(cols * rows).fill(Number.POSITIVE_INFINITY);
  const came = new Int32Array(cols * rows).fill(-1);
  const done = new Uint8Array(cols * rows);
  const heap = new CellHeap();
  const guess = (c: number) => {
    const dx = (c % cols) * stepX - gx;
    const dy = Math.floor(c / cols) * stepY - gy;
    return Math.sqrt(dx * dx + dy * dy);
  };
  best[start] = 0;
  heap.push(start, guess(start));
  while (heap.size > 0) {
    const c = heap.pop();
    if (done[c]) continue;
    done[c] = 1;
    if (c === goal) break;
    const ci = c % cols;
    const cj = (c - ci) / cols;
    for (const [di, dj] of NEIGHBOURS) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const n = nj * cols + ni;
      if (done[n]) continue;
      const cost = best[c] + stepCost(grid, c, n);
      if (cost < best[n]) {
        best[n] = cost;
        came[n] = c;
        heap.push(n, cost + guess(n));
      }
    }
  }
  const out: MapXY[] = [];
  for (let c = goal; c !== -1; c = came[c]) {
    out.push([(c % cols) * stepX, Math.floor(c / cols) * stepY]);
    if (c === start) break;
  }
  return out.reverse();
}

/** Distance from a point to the segment between two others. */
function segmentDistance(p: MapXY, a: MapXY, b: MapXY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2),
        );
  const ex = a[0] + dx * t - p[0];
  const ey = a[1] + dy * t - p[1];
  return Math.sqrt(ex * ex + ey * ey);
}

/**
 * Drop the points of a line that lie within `tolerance` of the line through
 * their neighbours (Douglas and Peucker), so a staircase of cells becomes the
 * few straight runs it stands for. `mustSplit`, when given, can refuse a
 * shortcut between points `first` and `last` however close it runs.
 */
export function simplifyLine(
  line: MapXY[],
  tolerance: number,
  mustSplit?: (first: number, last: number) => boolean,
): MapXY[] {
  if (line.length < 3) return line.slice();
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    let worst = -1;
    let worstAt = -1;
    for (let k = first + 1; k < last; k++) {
      const d = segmentDistance(line[k], line[first], line[last]);
      if (d > worst) {
        worst = d;
        worstAt = k;
      }
    }
    if (worst > tolerance || (worstAt > 0 && mustSplit?.(first, last))) {
      keep[worstAt] = 1;
      stack.push([first, worstAt], [worstAt, last]);
    }
  }
  return line.filter((_, k) => keep[k] === 1);
}

/** The height at a map position, read from the nearest cell. */
function heightNear(grid: RouteGrid, [x, y]: MapXY): number {
  return grid.height[cellAt(grid, [x, y])];
}

/**
 * Whether the straight line between points `first` and `last` of a route
 * climbs higher than the route does between them, or crosses water it does
 * not. A shortcut like that would carry a smoothed road over a shoulder of
 * the hill the route went round.
 */
function shortcutClimbs(
  grid: RouteGrid,
  line: MapXY[],
  first: number,
  last: number,
): boolean {
  let top = 0;
  let dry = true;
  for (let k = first; k <= last; k++) {
    const h = heightNear(grid, line[k]);
    if (h > top) top = h;
    if (h < SEA_LEVEL) dry = false;
  }
  const [ax, ay] = line[first];
  const [bx, by] = line[last];
  const cell = Math.min(grid.stepX, grid.stepY);
  const samples = Math.ceil(Math.hypot(bx - ax, by - ay) / (cell / 2));
  for (let s = 1; s < samples; s++) {
    const f = s / samples;
    const h = heightNear(grid, [ax + (bx - ax) * f, ay + (by - ay) * f]);
    if (h > top + CLIMB_ALLOWANCE || (dry && h < SEA_LEVEL)) return true;
  }
  return false;
}

/** How much higher than its route a shortcut may climb, as a share of 1. */
const CLIMB_ALLOWANCE = 4 / 255;

/** Cut each stretch of a line longer than `most` into equal pieces. */
function splitLong(line: MapXY[], most: number): MapXY[] {
  const out: MapXY[] = [line[0]];
  for (let k = 1; k < line.length; k++) {
    const [ax, ay] = line[k - 1];
    const [bx, by] = line[k];
    const pieces = Math.ceil(Math.hypot(bx - ax, by - ay) / most);
    for (let s = 1; s < pieces; s++) {
      const f = s / pieces;
      out.push([ax + (bx - ax) * f, ay + (by - ay) * f]);
    }
    out.push(line[k]);
  }
  return out;
}

/**
 * Round a line's corners by cutting each a quarter of the way along its two
 * sides (Chaikin), `rounds` times. The two ends stay where they are.
 */
export function roundCorners(line: MapXY[], rounds: number): MapXY[] {
  let out = line;
  for (let r = 0; r < rounds && out.length > 2; r++) {
    const next: MapXY[] = [out[0]];
    for (let k = 0; k < out.length - 1; k++) {
      const [ax, ay] = out[k];
      const [bx, by] = out[k + 1];
      if (k > 0) next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      if (k < out.length - 2) {
        next.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
      }
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/**
 * A road's route between two map positions: the cheapest chain of cells,
 * straightened within two cells of its course where that climbs no higher,
 * then rounded. It starts and ends on the two positions exactly.
 */
export function routeRoad(grid: RouteGrid, from: MapXY, to: MapXY): MapXY[] {
  const cells = cheapestCells(grid, from, to);
  const line: MapXY[] = [from, ...cells.slice(1, -1), to];
  const cell = Math.min(grid.stepX, grid.stepY);
  const straight = simplifyLine(line, cell * 2, (first, last) =>
    shortcutClimbs(grid, line, first, last),
  );
  // Rounding cuts a quarter off each side of a corner, so long runs are
  // split first and no corner is cut by more than about a cell.
  const round = roundCorners(splitLong(straight, cell * 3), 4);
  // Rounding leaves many points along gentle curves. Thinning them to within
  // a fiftieth of a cell keeps the curve and makes the line cheap to draw.
  return simplifyLine(round, cell * 0.02);
}
