import {
  assembleGalaxy,
  type GenerateOptions,
  generatedNodeCount,
} from "./generate";
import type { GalaxyDoc, LinkKind } from "./model";
import { mulberry32 } from "./rng";
import type { GeneratedTerrain } from "./terrainGen";
import { type DividedLand, divideLand, landTerrain } from "./territories";

/**
 * The Cities map style (issues #3506 and #3617): cities on generated land,
 * joined by roads.
 *
 * The land comes first, from the same generator as the Territories style. It
 * is divided into one region per city exactly as Territories divides it into
 * provinces, and each city is built at the most habitable place in its region:
 * low ground near the coast, well inside the region. Two cities whose regions
 * share a border can be joined by a road, and a road is left out where it
 * would cross high mountains, cross the sea or pass another city, as long as
 * every city can still be reached. Land masses are joined by sea crossings.
 * Capitals, factions, starting territory, difficulty and battle maps come from
 * the shared `assembleGalaxy`.
 *
 * Deterministic from the seed on every platform, on the same terms as
 * `terrainGen.ts`: integers, the exactly defined float operations and
 * `Math.sqrt`. `citiesGolden.test.ts` pins the documents and the pixels.
 */

/**
 * What a Cities document puts in `terrain.image` and `terrain.heightmap` in
 * place of a URL. The pixels are not stored: `generatedTerrain` rebuilds them
 * from the seed, the layout and the number of cities.
 */
export const GENERATED_CITIES_IMAGE = "generated:cities";

/** The galaxy options, less the ones that only mean something for stars. */
export type CitiesOptions = Omit<
  GenerateOptions,
  "layout" | "radiusLy" | "skin"
> & {
  /** How the land is arranged. `random` picks one from the seed. */
  layout?: GenerateOptions["layout"];
};

type Pt = [number, number];

/** A pixel this close to the sea, in pixels, counts as on the coast. */
const COAST_REACH = 8;
/** A road whose highest point is above this height, out of 255, crosses
 * mountains, and is left out when the map stays connected without it. */
const MOUNTAIN_ROAD = 110;
/** A road with more than this many sea pixels under it crosses water. */
const WET_ROAD = 2;

/**
 * The pixel each city is built on: the best place in its region. Being well
 * inside the region counts most, so cities do not crowd a border, then being
 * low, then being near the coast. Ties go to the earlier pixel.
 */
function citySites(terrain: GeneratedTerrain, land: DividedLand): number[] {
  const { owner, depth } = land;
  const { heightmap, coastDistance } = terrain;
  const count = land.anchors.length;
  const deepest = new Int32Array(count);
  for (let i = 0; i < owner.length; i++) {
    const p = owner[i];
    if (p >= 0 && depth[i] > deepest[p]) deepest[p] = depth[i];
  }
  const best = new Int32Array(count).fill(-1);
  const bestScore = new Float64Array(count).fill(Number.NEGATIVE_INFINITY);
  for (let i = 0; i < owner.length; i++) {
    const p = owner[i];
    if (p < 0) continue;
    // Inside the region: full marks from four fifths of the deepest point in.
    const inside = Math.min(1, (depth[i] * 5) / (deepest[p] * 4));
    const coastal = coastDistance[i] <= COAST_REACH * 3 ? 0.3 : 0;
    const high = heightmap[i] / 255;
    const score = inside * 1.5 + coastal - high;
    if (score > bestScore[p]) {
      bestScore[p] = score;
      best[p] = i;
    }
  }
  return Array.from(best);
}

/** The pixels a straight line between two pixel centres passes over. */
function pixelsBetween(width: number, a: number, b: number): number[] {
  const ax = a % width;
  const ay = (a - ax) / width;
  const bx = b % width;
  const by = (b - bx) / width;
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
  const out: number[] = [];
  for (let k = 0; k <= steps; k++) {
    const x = Math.floor(ax + ((bx - ax) * k) / steps + 0.5);
    const y = Math.floor(ay + ((by - ay) * k) / steps + 0.5);
    out.push(y * width + x);
  }
  return out;
}

/**
 * Which neighbouring regions get a road, and of what kind. A border is a
 * candidate road. The candidates that read badly are dropped one at a time
 * while the cities stay connected: first a road that passes closer to a third
 * city than to either end, which would read as two roads, then one over high
 * mountains, highest first.
 */
function chooseRoads(
  terrain: GeneratedTerrain,
  land: DividedLand,
  sites: number[],
): { roads: [number, number][]; kinds: LinkKind[] } {
  const { width, heightmap } = terrain;
  const xy = (p: number): Pt => {
    const x = sites[p] % width;
    return [x, (sites[p] - x) / width];
  };
  const d2 = (a: Pt, b: Pt) =>
    (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);

  const candidates = land.borders.map(([a, b]) => {
    const line = pixelsBetween(width, sites[a], sites[b]);
    let top = 0;
    let wet = 0;
    for (const i of line) {
      if (heightmap[i] > top) top = heightmap[i];
      if (heightmap[i] === 0) wet++;
    }
    // Another city inside the circle on this road as its diameter.
    const pa = xy(a);
    const pb = xy(b);
    const span = d2(pa, pb);
    let crowded = false;
    for (let c = 0; c < sites.length && !crowded; c++) {
      if (c === a || c === b) continue;
      const pc = xy(c);
      crowded = d2(pa, pc) + d2(pc, pb) < span;
    }
    return { pair: [a, b] as [number, number], top, wet, crowded };
  });

  const keep = candidates.map(() => true);
  const connectedWithout = (skip: number) => {
    const parent = sites.map((_, i) => i);
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    let groups = sites.length;
    const join = ([a, b]: [number, number]) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) {
        parent[ra] = rb;
        groups--;
      }
    };
    candidates.forEach((c, i) => {
      if (keep[i] && i !== skip) join(c.pair);
    });
    for (const pair of land.crossings) join(pair);
    return groups === 1;
  };
  const order = candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.crowded || c.top > MOUNTAIN_ROAD)
    .sort(
      (x, y) =>
        Number(y.c.crowded) - Number(x.c.crowded) ||
        y.c.top - x.c.top ||
        x.i - y.i,
    );
  for (const { i } of order) {
    if (connectedWithout(i)) keep[i] = false;
  }

  const roads: [number, number][] = [];
  const kinds: LinkKind[] = [];
  candidates.forEach((c, i) => {
    if (!keep[i]) return;
    roads.push(c.pair);
    kinds.push(c.wet > WET_ROAD ? "crossing" : "road");
  });
  for (const pair of land.crossings) {
    roads.push(pair);
    kinds.push("crossing");
  }
  return { roads, kinds };
}

/**
 * Generate a complete, playable Cities map. The document is in the same model
 * as an authored one: every node is a point with no outline, every link is a
 * road or a crossing, and `terrain` names the generated land (see
 * {@link GENERATED_CITIES_IMAGE}).
 */
export function generateCities(
  opts: CitiesOptions,
  now: string = new Date().toISOString(),
): GalaxyDoc {
  const rng = mulberry32(opts.seed);
  const count = generatedNodeCount(opts);
  const terrain = landTerrain(opts.seed, opts.layout, count, rng);
  const land = divideLand(terrain, count, rng);
  const sites = citySites(terrain, land);
  const { roads, kinds } = chooseRoads(terrain, land, sites);
  const scale = terrain.mapWidth / terrain.width;
  const doc = assembleGalaxy(
    opts,
    rng,
    {
      source: sites.map((pixel) => {
        const x = pixel % terrain.width;
        const y = (pixel - x) / terrain.width;
        return { pos: [(x + 0.5) * scale, (y + 0.5) * scale, 0] };
      }),
      links: roads,
      exactDistance: true,
      land: true,
    },
    now,
  );
  return {
    ...doc,
    description: `A generated map of ${doc.nodes.length} cities.`,
    theme: { skin: "cities" },
    generated: doc.generated && { ...doc.generated, skin: "cities" },
    terrain: {
      image: GENERATED_CITIES_IMAGE,
      heightmap: GENERATED_CITIES_IMAGE,
      width: terrain.mapWidth,
      height: terrain.mapHeight,
      heightScale: terrain.heightScale,
      projection: "flat",
    },
    linkKinds: roads.map(([a, b], i): [string, string, LinkKind] => [
      doc.nodes[a].id,
      doc.nodes[b].id,
      kinds[i],
    ]),
  };
}
