/**
 * Where every tree of a terrain map stands. Pure: no three.js and no GPU, so
 * the same map always plants the same forest and a test can count it.
 *
 * Trees are thrown one to a small cell, each anywhere in its cell, and a tree
 * that would stand inside a neighbour's crown is dropped. The cells are
 * visited in a shuffled order, so the forest has no rows. Slow noise fields
 * pick the kind of tree a stand holds, how old it is and where its glades
 * lie, and a little grassland grows copses and lone trees.
 */
import { noise3, seeded, smooth } from "../landmarks/kit";

/** A kind of tree. Sizes are in world units, where a town lot is 0.25. */
export interface Species {
  id: "oak" | "beech" | "spruce" | "pine" | "birch" | "shrub";
  /** Draws in the planet's conifer colours. */
  conifer: boolean;
  /** Its height, shortest and tallest. */
  height: [number, number];
  /** Its crown's width as a share of its height. */
  spread: number;
}

/**
 * A low building of an open town is 0.18 high, so a grown broadleaf tree is a
 * little taller than one and a spruce stands up to twice as tall.
 */
export const SPECIES: readonly Species[] = [
  { id: "oak", conifer: false, height: [0.15, 0.24], spread: 0.95 },
  { id: "beech", conifer: false, height: [0.2, 0.3], spread: 0.68 },
  { id: "spruce", conifer: true, height: [0.2, 0.34], spread: 0.36 },
  { id: "pine", conifer: true, height: [0.2, 0.3], spread: 0.5 },
  { id: "birch", conifer: false, height: [0.14, 0.22], spread: 0.4 },
  { id: "shrub", conifer: false, height: [0.04, 0.08], spread: 1.1 },
];
const [OAK, BEECH, SPRUCE, PINE, BIRCH, SHRUB] = [0, 1, 2, 3, 4, 5];

/** The ground a forest is planted on. */
export interface ForestGround {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Ground height in world units. */
  height(x: number, z: number): number;
  /** Anything below this is sea. */
  seaLevel: number;
  /** The highest ground, for where conifers take over. */
  maxHeight: number;
  /** Fill `out` with the shares of forest, cold forest and grass, 0 to 1. */
  cover(x: number, z: number, out: Float32Array): void;
  /** Distance to the nearest river's edge in world units, below 0 on it. */
  riverEdge?(x: number, z: number): number;
  /** True where nothing may grow: a town, a landmark or a road. */
  blocked?(x: number, z: number): boolean;
}

/** Every tree, one entry in each array. */
export interface Forest {
  count: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  height: Float32Array;
  width: Float32Array;
  /** Turn about the vertical, in radians. */
  turn: Float32Array;
  /** 0 to 1, the tree's own shade of its colour. */
  pick: Float32Array;
  /** How far up the tree its neighbours' shadow reaches, 0 to 1. */
  shade: Float32Array;
  /** Index into {@link SPECIES}. */
  species: Uint8Array;
  /** 1 for a broadleaf tree turning colour. */
  turning: Uint8Array;
}

/** The side of a planting cell. No two trees stand closer than this. */
export const CELL = 0.07;
/** Two crowns may overlap by this share of their widths, for a closed canopy. */
const CROWN_FIT = 0.32;
/** No tree grows closer to a river's edge than this. */
const RIVER_CLEAR = 0.03;
/** The slopes trees thin out over, as rise over run. */
const SLOPE_FROM = 0.45;
const SLOPE_TO = 0.85;
/** How far a neighbour's shadow is looked for, in world units. */
const SHADE_REACH = 0.42;

/**
 * Plant `ground`. `sun` is the direction to the sun, and `autumn` the share
 * of broadleaf stands turning colour.
 */
export function plantForest(
  ground: ForestGround,
  seed: number,
  sun: [number, number, number],
  autumn = 0,
): Forest {
  const cols = Math.max(1, Math.ceil((ground.maxX - ground.minX) / CELL));
  const rows = Math.max(1, Math.ceil((ground.maxZ - ground.minZ) / CELL));
  const cells = cols * rows;
  const at = new Int32Array(cells).fill(-1);
  const rand = seeded(seed);
  const off = (rand() * 1000) | 0;
  const field = (x: number, z: number, size: number, layer: number) =>
    noise3(x / size + off, layer * 17.3, z / size - off);

  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const heights: number[] = [];
  const widths: number[] = [];
  const turns: number[] = [];
  const picks: number[] = [];
  const species: number[] = [];
  const turning: number[] = [];
  const shares = new Float32Array(3);

  // A stride that shares no factor with the cell count visits every cell
  // once, in an order with no rows in it.
  let stride = Math.floor(cells * 0.6180339887) | 1;
  while (gcd(stride, cells) !== 1) stride += 2;
  let cell = (rand() * cells) | 0;
  for (let n = 0; n < cells; n++) {
    cell = (cell + stride) % cells;
    const i = cell % cols;
    const j = (cell - i) / cols;
    const jx = rand();
    const jz = rand();
    const chance = rand();
    const x = ground.minX + (i + jx) * CELL;
    const z = ground.minZ + (j + jz) * CELL;
    // The last cell of a row or column can reach past the ground.
    if (x >= ground.maxX || z >= ground.maxZ) continue;
    ground.cover(x, z, shares);
    const woods = Math.min(1, shares[0] + shares[1]);
    const grass = shares[2];
    if (woods < 0.05 && grass < 0.5) continue;
    const y = ground.height(x, z);
    if (y < ground.seaLevel) continue;

    // Forest, thinning to single trees at its edge, with glades.
    const glade = smooth(0.26, 0.36, field(x, z, 2.2, 1));
    let density = smooth(0.25, 0.6, woods) * glade;
    // Grassland grows copses and the odd lone tree.
    const copse =
      grass > 0.5 ? smooth(0.7, 0.8, field(x, z, 1.6, 2)) * 0.55 + 0.004 : 0;
    const open = copse > density;
    density = Math.max(density, copse);
    if (chance > density) continue;
    const slope = slopeAt(ground, x, z);
    if (rand() < smooth(SLOPE_FROM, SLOPE_TO, slope)) continue;
    if (ground.riverEdge && ground.riverEdge(x, z) < RIVER_CLEAR) continue;
    if (ground.blocked?.(x, z)) continue;

    // The stand this tree belongs to decides its kind.
    const taiga = woods > 0 ? shares[1] / (shares[0] + shares[1]) : 0;
    const high = ground.maxHeight > 0 ? y / ground.maxHeight : 0;
    const stands = field(x, z, 5.5, 3);
    const conifer = Math.min(
      1,
      Math.max(
        taiga,
        smooth(0.3, 0.5, high + (stands - 0.5) * 0.2) * 0.85 +
          smooth(0.62, 0.78, stands) * 0.7,
      ),
    );
    let kind: number;
    const fringe = !open && woods < 0.45;
    if ((fringe && rand() < 0.35) || (open && rand() < 0.2)) kind = SHRUB;
    else if (taiga > 0.5 && field(x, z, 1.8, 4) > 0.64) kind = BIRCH;
    else if (rand() < conifer)
      kind = field(x, z, 3.1, 5) > 0.58 && taiga < 0.5 ? PINE : SPRUCE;
    else if (rand() < 0.06) kind = BIRCH;
    else kind = field(x, z, 2.7, 6) > 0.52 ? BEECH : OAK;
    // A few of another kind grow in any stand.
    if (kind !== SHRUB && rand() < 0.08)
      kind = [OAK, BEECH, SPRUCE, PINE][(rand() * 4) | 0];

    const sp = SPECIES[kind];
    // Old stands and young ones, and smaller trees at the forest's edge.
    const age = 0.72 + 0.5 * field(x, z, 3.4, 7);
    const edge = open ? 1 : 0.7 + 0.3 * smooth(0.3, 0.8, woods);
    const h =
      (sp.height[0] + (sp.height[1] - sp.height[0]) * rand()) * age * edge;
    const w = h * sp.spread * (0.85 + 0.3 * rand());

    // Drop it if it stands inside a crown already planted.
    const reach = Math.ceil((CROWN_FIT * (w + 0.4)) / CELL);
    let free = true;
    for (let dj = -reach; dj <= reach && free; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= rows) continue;
      for (let di = -reach; di <= reach; di++) {
        const ii = i + di;
        if (ii < 0 || ii >= cols) continue;
        const o = at[jj * cols + ii];
        if (o < 0) continue;
        const gap = CROWN_FIT * (w + widths[o]);
        const dx = xs[o] - x;
        const dz = zs[o] - z;
        if (dx * dx + dz * dz < gap * gap) {
          free = false;
          break;
        }
      }
    }
    if (!free) continue;

    at[cell] = xs.length;
    xs.push(x);
    ys.push(y);
    zs.push(z);
    heights.push(h);
    widths.push(w);
    turns.push(rand() * Math.PI * 2);
    picks.push(rand());
    species.push(kind);
    const turns_ =
      !sp.conifer &&
      kind !== SHRUB &&
      autumn > 0 &&
      smooth(0.5, 0.62, field(x, z, 2.9, 8)) * autumn * 2.2 > rand();
    turning.push(turns_ ? 1 : 0);
  }

  const count = xs.length;
  const forest: Forest = {
    count,
    x: Float32Array.from(xs),
    y: Float32Array.from(ys),
    z: Float32Array.from(zs),
    height: Float32Array.from(heights),
    width: Float32Array.from(widths),
    turn: Float32Array.from(turns),
    pick: Float32Array.from(picks),
    shade: new Float32Array(count),
    species: Uint8Array.from(species),
    turning: Uint8Array.from(turning),
  };

  // How far up each tree the trees toward the sun shade it.
  const flat = Math.hypot(sun[0], sun[2]);
  const sx = sun[0] / flat;
  const sz = sun[2] / flat;
  const rise = sun[1] / flat;
  const span = Math.ceil(SHADE_REACH / CELL);
  for (let t = 0; t < count; t++) {
    const i = Math.floor((forest.x[t] - ground.minX) / CELL);
    const j = Math.floor((forest.z[t] - ground.minZ) / CELL);
    let top = 0;
    for (let dj = -span; dj <= span; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= rows) continue;
      for (let di = -span; di <= span; di++) {
        const ii = i + di;
        if (ii < 0 || ii >= cols) continue;
        const o = at[jj * cols + ii];
        if (o < 0 || o === t) continue;
        const dx = forest.x[o] - forest.x[t];
        const dz = forest.z[o] - forest.z[t];
        const along = dx * sx + dz * sz;
        if (along <= 0) continue;
        const across = Math.abs(dx * sz - dz * sx);
        if (across > (forest.width[o] + forest.width[t]) / 2) continue;
        const reach =
          forest.y[o] + forest.height[o] * 0.85 - along * rise - forest.y[t];
        top = Math.max(top, reach / forest.height[t]);
      }
    }
    forest.shade[t] = Math.min(1, top);
  }
  return forest;
}

function slopeAt(ground: ForestGround, x: number, z: number): number {
  const d = 0.12;
  const gx = (ground.height(x + d, z) - ground.height(x - d, z)) / (2 * d);
  const gz = (ground.height(x, z + d) - ground.height(x, z - d)) / (2 * d);
  return Math.hypot(gx, gz);
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * What the forest does to the ground under it, as two bytes a pixel over the
 * rectangle `ground` covers: how much canopy stands over the pixel, then how
 * much shadow the trees throw on it.
 */
export function forestCoverPixels(
  forest: Forest,
  ground: Pick<ForestGround, "minX" | "maxX" | "minZ" | "maxZ">,
  width: number,
  height: number,
  sun: [number, number, number],
): Uint8Array {
  const out = new Uint8Array(width * height * 2);
  const px = width / (ground.maxX - ground.minX);
  const pz = height / (ground.maxZ - ground.minZ);
  const flat = Math.hypot(sun[0], sun[2]);
  // A shadow falls away from the sun, as long as the tree is tall over the
  // sun's rise.
  const fx = -sun[0] / flat;
  const fz = -sun[2] / flat;
  const length = flat / sun[1];
  const blot = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    r: number,
    channel: number,
    strength: number,
  ) => {
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r) * px));
    const i1 = Math.min(width - 1, Math.ceil((Math.max(ax, bx) + r) * px));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - r) * pz));
    const j1 = Math.min(height - 1, Math.ceil((Math.max(az, bz) + r) * pz));
    const ex = bx - ax;
    const ez = bz - az;
    const len2 = ex * ex + ez * ez;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) / px - ax;
        const z = (j + 0.5) / pz - az;
        const t =
          len2 > 0 ? Math.min(1, Math.max(0, (x * ex + z * ez) / len2)) : 0;
        const d = Math.hypot(x - ex * t, z - ez * t);
        const v = Math.round(255 * strength * (1 - smooth(r * 0.6, r, d)));
        const k = (j * width + i) * 2 + channel;
        if (v > out[k]) out[k] = v;
      }
  };
  for (let t = 0; t < forest.count; t++) {
    const x = forest.x[t] - ground.minX;
    const z = forest.z[t] - ground.minZ;
    const r = forest.width[t] / 2;
    const low = forest.species[t] === SHRUB;
    blot(x, z, x, z, r * 1.15, 0, low ? 0.5 : 1);
    const reach = forest.height[t] * 0.8 * length;
    blot(x, z, x + fx * reach, z + fz * reach, r * 0.9, 1, 1);
  }
  return out;
}
