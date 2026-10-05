import {
  type GalaxyLayout,
  type GenerateOptions,
  generateGalaxy,
} from "./generate";
import type { GalaxyDoc, LinkKind } from "./model";
import {
  type GeneratedTerrain,
  generateTerrain,
  labelLandMasses,
  TERRAIN_MAP_UNITS,
  terrainPixelAt,
} from "./terrainGen";

/**
 * The Cities map style (issue #3506): the locations and links of a galaxy,
 * drawn as cities on generated land and joined by roads.
 *
 * The cities are `generateGalaxy`'s own. This calls it and keeps every node,
 * link, owner, capital, difficulty and battle map it returns, so a seed gives
 * the same strategic map here as it does in the Galaxy and Theatre styles. Only
 * the positions change, by {@link cityMapScale}, and only to put them in map
 * units. The land is drawn from a separate random stream (see
 * `generateTerrain`), so it cannot move a draw the galaxy makes.
 *
 * Everything added here is integers, the exactly defined float operations and
 * `Math.sqrt`, on the same terms as `terrainGen.ts`. The scatter underneath
 * still uses `Math.cos` and `Math.log`, as it does for a galaxy, and its
 * positions are rounded to one decimal place before anything here reads them.
 * `citiesGolden.test.ts` pins the documents and the pixels.
 */

/**
 * What a Cities document puts in `terrain.image` and `terrain.heightmap` in
 * place of a URL. The pixels are not stored: `generatedTerrain` rebuilds them
 * from the seed in `generated` and the positions of the document's own nodes.
 */
export const GENERATED_CITIES_IMAGE = "generated:cities";

/** The galaxy options, less the ones that only mean something for stars. */
export type CitiesOptions = Omit<
  GenerateOptions,
  "layout" | "radiusLy" | "skin"
> & {
  /** How the cities are arranged. `random` picks one from the seed. */
  layout?: GalaxyLayout | "random";
};

type Pt = [number, number];

/**
 * The radius of the land around a city, in mean distances from a city to its
 * nearest neighbour. Measured over seeds 1 to 5 at every wizard size and
 * layout, this makes 83% to 98% of links roads and leaves the long ones as
 * crossings. At 0.9 the share is 75% to 91%, and at 1.3 nearly every map is
 * one land mass.
 */
const LAND_RADIUS_IN_SPACINGS = 1;
/** How far past its radius the noise can carry a city's land. */
const COAST_REACH = 1.1;

const CENTRE = TERRAIN_MAP_UNITS / 2;

const round1 = (v: number) => Math.round(v * 10) / 10;

/** The mean distance from each point to the nearest other point. */
function meanNearest(points: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    let best = Number.POSITIVE_INFINITY;
    for (let j = 0; j < points.length; j++) {
      if (j === i) continue;
      const dx = points[i][0] - points[j][0];
      const dy = points[i][1] - points[j][1];
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    sum += Math.sqrt(best);
  }
  return sum / points.length;
}

/**
 * Map units per galaxy unit for a set of galaxy positions. A galaxy position
 * `[x, y]` becomes the city position `[512 + scale * x, 512 + scale * y]`,
 * rounded to one decimal place: the galaxy's origin goes to the middle of the
 * map and nothing is flipped, since both count y downwards. The scale is the
 * largest that keeps the farthest city, and the land around it, inside the map.
 */
export function cityMapScale(galaxyPositions: Pt[]): number {
  let reach = 0;
  for (const [x, y] of galaxyPositions) {
    reach = Math.max(reach, Math.abs(x), Math.abs(y));
  }
  const coast =
    COAST_REACH * LAND_RADIUS_IN_SPACINGS * meanNearest(galaxyPositions);
  return CENTRE / (reach + coast);
}

/**
 * The land for a set of cities, given in map units: a patch around each one,
 * sized by how far apart the cities are, so near neighbours share a land mass
 * and distant ones are separated by sea.
 */
export function citiesTerrain(seed: number, cities: Pt[]): GeneratedTerrain {
  return generateTerrain({
    seed,
    mustBeLand: cities,
    landRadius: LAND_RADIUS_IN_SPACINGS * meanNearest(cities),
  });
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
  const galaxy = generateGalaxy(opts, now);
  const scale = cityMapScale(galaxy.nodes.map((n) => [n.pos[0], n.pos[1]]));
  const nodes = galaxy.nodes.map((node) => ({
    ...node,
    pos: [
      round1(CENTRE + scale * node.pos[0]),
      round1(CENTRE + scale * node.pos[1]),
    ] as Pt,
  }));
  const terrain = citiesTerrain(
    opts.seed,
    nodes.map((n) => n.pos),
  );

  // A road stays on one land mass. Anything else has sea to get over.
  const { labels } = labelLandMasses(terrain);
  const mass = new Map(
    nodes.map((n) => [
      n.id,
      labels[terrainPixelAt(terrain, n.pos[0], n.pos[1])],
    ]),
  );
  return {
    ...galaxy,
    description: `A generated map of ${nodes.length} cities.`,
    theme: { skin: "cities" },
    generated: galaxy.generated && { ...galaxy.generated, skin: "cities" },
    nodes,
    terrain: {
      image: GENERATED_CITIES_IMAGE,
      heightmap: GENERATED_CITIES_IMAGE,
      width: terrain.mapWidth,
      height: terrain.mapHeight,
      heightScale: terrain.heightScale,
      projection: "flat",
    },
    linkKinds: galaxy.links.map(([a, b]): [string, string, LinkKind] => [
      a,
      b,
      mass.get(a) === mass.get(b) ? "road" : "crossing",
    ]),
  };
}
