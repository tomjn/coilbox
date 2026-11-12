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

/** A kind of tree, plant or rock. Sizes are in world units, where a town lot is 0.25. */
export interface Species {
  id:
    | "oak"
    | "beech"
    | "spruce"
    | "pine"
    | "birch"
    | "shrub"
    | "boulder"
    | "crag"
    | "cactus"
    | "palm"
    | "acacia"
    | "snag";
  /** What it is made of: leaves on a stem, rock, bare wood or a cactus's flesh. */
  look: "leaf" | "rock" | "wood" | "cactus";
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
  {
    id: "oak",
    look: "leaf",
    conifer: false,
    height: [0.15, 0.24],
    spread: 0.95,
  },
  {
    id: "beech",
    look: "leaf",
    conifer: false,
    height: [0.2, 0.3],
    spread: 0.68,
  },
  {
    id: "spruce",
    look: "leaf",
    conifer: true,
    height: [0.2, 0.34],
    spread: 0.36,
  },
  { id: "pine", look: "leaf", conifer: true, height: [0.2, 0.3], spread: 0.5 },
  {
    id: "birch",
    look: "leaf",
    conifer: false,
    height: [0.14, 0.22],
    spread: 0.4,
  },
  {
    id: "shrub",
    look: "leaf",
    conifer: false,
    height: [0.04, 0.08],
    spread: 1.1,
  },
  // Rocks are the size of a house, not of a pebble: anything smaller is
  // under two pixels at the closest zoom.
  {
    id: "boulder",
    look: "rock",
    conifer: false,
    height: [0.03, 0.08],
    spread: 1.6,
  },
  {
    id: "crag",
    look: "rock",
    conifer: false,
    height: [0.06, 0.14],
    spread: 1.3,
  },
  // Drawn stouter than a real one, which would be a line one pixel wide.
  {
    id: "cactus",
    look: "cactus",
    conifer: true,
    height: [0.08, 0.14],
    spread: 0.55,
  },
  {
    id: "palm",
    look: "leaf",
    conifer: false,
    height: [0.14, 0.22],
    spread: 0.6,
  },
  {
    id: "acacia",
    look: "leaf",
    conifer: false,
    height: [0.1, 0.16],
    spread: 1.3,
  },
  { id: "snag", look: "wood", conifer: false, height: [0.1, 0.2], spread: 0.4 },
];
const [OAK, BEECH, SPRUCE, PINE, BIRCH, SHRUB] = [0, 1, 2, 3, 4, 5];
const [BOULDER, CRAG, CACTUS, PALM, ACACIA, SNAG] = [6, 7, 8, 9, 10, 11];

/** How many shares {@link ForestGround.cover} fills. */
export const COVER_SHARES = 7;

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
  /**
   * Fill `out` with what the ground is, each 0 to 1: forest, cold forest,
   * grass, scrub, stony ground that is mostly rock, bare ground with a few
   * rocks on it, and tundra.
   */
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
/** The slopes rocks give out over. Steeper ground is drawn as bare rock. */
const ROCK_SLOPE_FROM = 0.2;
const ROCK_SLOPE_TO = 0.4;
/** How far a neighbour's shadow is looked for, in world units. */
const SHADE_REACH = 0.42;

/** What grows on the planet being planted. */
export interface PlantOptions {
  /** The share of broadleaf stands turning colour. */
  autumn?: number;
  /** Something grows here at all. A dead world gets rocks alone. */
  alive?: boolean;
  /** A dry world: its scrub holds cactus and acacia, and palms line its rivers. */
  arid?: boolean;
}

/** Plant `ground`. `sun` is the direction to the sun. */
export function plantForest(
  ground: ForestGround,
  seed: number,
  sun: [number, number, number],
  opts: PlantOptions = {},
): Forest {
  const autumn = opts.autumn ?? 0;
  const alive = opts.alive ?? true;
  const arid = opts.arid ?? false;
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
  const shares = new Float32Array(COVER_SHARES);

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
    const woods = alive ? Math.min(1, shares[0] + shares[1]) : 0;
    const grass = alive ? shares[2] : 0;
    const scrub = alive ? shares[3] : 0;
    const rocky = shares[4] + shares[5];
    if (woods < 0.05 && grass < 0.5 && scrub < 0.05 && rocky < 0.05) continue;
    const y = ground.height(x, z);
    if (y < ground.seaLevel) continue;
    const slope = slopeAt(ground, x, z);

    // Forest, thinning to single trees at its edge, with glades.
    const glade = smooth(0.26, 0.36, field(x, z, 2.2, 1));
    let trees = smooth(0.25, 0.6, woods) * glade;
    // Grassland grows copses and the odd lone tree.
    const copse =
      grass > 0.5 ? smooth(0.7, 0.8, field(x, z, 1.6, 2)) * 0.55 + 0.004 : 0;
    const open = copse > trees;
    trees = Math.max(trees, copse);
    // Trees give out as the ground steepens.
    trees *= 1 - smooth(SLOPE_FROM, SLOPE_TO, slope);
    // A dry world's rivers are lined with palms.
    const bank = arid && ground.riverEdge ? ground.riverEdge(x, z) : 9;
    const oasis = bank < 0.3 ? 0.1 : 0;
    // Rocks lie on stony ground, and a few on bare ground, in fields with
    // open ground between. None lies on a cliff or a steep hillside, which
    // is bare rock already.
    const rocks =
      (shares[4] * 0.025 + shares[5] * 0.0075) *
      (0.25 + 1.5 * smooth(0.4, 0.75, field(x, z, 1.3, 9))) *
      (1 - smooth(ROCK_SLOPE_FROM, ROCK_SLOPE_TO, slope));
    // Brush: bushes on scrub, and a few low ones on tundra.
    const brush =
      scrub * 0.08 * (0.35 + 1.3 * field(x, z, 1.9, 10)) +
      (alive ? shares[6] * 0.01 : 0);

    let kind: number;
    let lone = open;
    const taiga = woods > 0 ? shares[1] / (shares[0] + shares[1]) : 0;
    if (chance < oasis) {
      kind = rand() < 0.7 ? PALM : SHRUB;
      lone = true;
    } else if (chance < oasis + trees) {
      // The stand this tree belongs to decides its kind.
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
      const fringe = !open && woods < 0.45;
      if ((fringe && rand() < 0.35) || (open && rand() < 0.2))
        // A cold forest's edge holds dead trees among its bushes.
        kind = taiga > 0.5 && rand() < 0.1 ? SNAG : SHRUB;
      else if (taiga > 0.5 && field(x, z, 1.8, 4) > 0.64) kind = BIRCH;
      else if (rand() < conifer)
        kind = field(x, z, 3.1, 5) > 0.58 && taiga < 0.5 ? PINE : SPRUCE;
      else if (rand() < 0.06) kind = BIRCH;
      else kind = field(x, z, 2.7, 6) > 0.52 ? BEECH : OAK;
      // A few of another kind grow in any stand.
      if (kind !== SHRUB && kind !== SNAG && rand() < 0.08)
        kind = [OAK, BEECH, SPRUCE, PINE][(rand() * 4) | 0];
    } else if (chance < oasis + trees + rocks) {
      kind = rand() < 0.1 ? CRAG : BOULDER;
      lone = true;
    } else if (chance < oasis + trees + rocks + brush) {
      const r = rand();
      if (arid)
        kind = r < 0.6 ? SHRUB : r < 0.82 ? CACTUS : r < 0.93 ? ACACIA : SNAG;
      else kind = r < 0.85 ? SHRUB : SNAG;
      lone = true;
    } else continue;
    if (ground.riverEdge && ground.riverEdge(x, z) < RIVER_CLEAR) continue;
    if (ground.blocked?.(x, z)) continue;

    const sp = SPECIES[kind];
    // Old stands and young ones, and smaller trees at the forest's edge.
    const age = 0.72 + 0.5 * field(x, z, 3.4, 7);
    const edge = lone ? 1 : 0.7 + 0.3 * smooth(0.3, 0.8, woods);
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
      kind <= BIRCH &&
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
    // Only leaves drop litter: a rock or a cactus stands on open ground.
    const sp = SPECIES[forest.species[t]];
    if (sp.look === "leaf")
      blot(x, z, x, z, r * 1.15, 0, forest.species[t] === SHRUB ? 0.5 : 1);
    const reach = forest.height[t] * 0.8 * length;
    blot(x, z, x + fx * reach, z + fz * reach, r * 0.9, 1, 1);
  }
  return out;
}
