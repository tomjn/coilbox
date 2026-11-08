import { select, t } from "@lingui/core/macro";
import { generateCities } from "./cities";
import { erodeRelief } from "./displayErosion";
import { playExtentFor } from "./galaxy3d/layout";
import { terrainMarginPixels } from "./galaxy3d/terrain";
import type { TerrainPixels } from "./galaxy3d/terrainLoad";
import { OUTPOST_RADIUS, TOWN_EDGE_MOST } from "./galaxy3d/towns";
import { type GenerateOptions, type GenMap, generateGalaxy } from "./generate";
import type { GalaxyDoc, MapSkin } from "./model";
import type { ConquestNames } from "./names";
import { planetOf } from "./planets";
import {
  carveValleys,
  desertShare,
  findRivers,
  riverEdgePixels,
} from "./rivers";
import { extendTerrain, TERRAIN_MAP_UNITS, TERRAIN_PIXELS } from "./terrainGen";
import { generatedTerrainWithMargin, generateTerritories } from "./territories";

/**
 * The four map styles a player can generate (issue #3507), and the one place
 * that turns a style into the generator that builds it. The wizard, a reroll,
 * a challenge import and the hub's preview all generate through
 * {@link generateMap}, so a style means the same map in each of them.
 */

/** The style choices, in the order both setup forms offer them. */
export const MAP_STYLE_OPTIONS: { value: MapSkin; label: string }[] = [
  {
    value: "galaxy",
    // Read when the picker draws, so it follows the language.
    get label() {
      return t`Galaxy (starfield)`;
    },
  },
  {
    value: "theatre",
    get label() {
      return t`Theatre (flat chart)`;
    },
  },
  {
    value: "cities",
    get label() {
      return t`Cities (roads across generated land)`;
    },
  },
  {
    value: "territories",
    get label() {
      return t`Territories (provinces on generated land)`;
    },
  },
];

/** What a style calls one of its locations, for player-facing text. */
export interface LocationNoun {
  one: string;
  many: string;
}

/** The English plural for each style, which `sizeOptions` selects its wording by. */
const LOCATION_KEYS: Record<MapSkin, string> = {
  galaxy: "systems",
  theatre: "locations",
  cities: "cities",
  territories: "provinces",
};

export function locationNounKey(skin: MapSkin | undefined): string {
  return LOCATION_KEYS[skin ?? "galaxy"];
}

/**
 * The words are for text that stands alone, such as a heading or a table label.
 * A sentence that holds one selects on the style instead, so each language words
 * the whole sentence around the noun.
 */
export function locationNoun(skin: MapSkin | undefined): LocationNoun {
  const style = skin ?? "galaxy";
  return {
    get one() {
      return select(style, {
        galaxy: "system",
        theatre: "location",
        cities: "city",
        territories: "province",
        other: "location",
      });
    },
    get many() {
      return select(style, {
        galaxy: "systems",
        theatre: "locations",
        cities: "cities",
        territories: "provinces",
        other: "locations",
      });
    },
  };
}

/**
 * The style a set of options builds. Real stars are a galaxy whatever style
 * was asked for alongside them, because the catalogue has no land to draw.
 * `generateGalaxy` has always built a Theatre map of real stars when handed
 * one, so that pairing is left as it is.
 */
export function mapSkinFor(
  opts: Pick<GenerateOptions, "skin" | "layout">,
): MapSkin {
  const skin = opts.skin ?? "galaxy";
  if (opts.layout !== "realstars") return skin;
  return skin === "theatre" ? "theatre" : "galaxy";
}

/** Generate a complete, playable map in the style the options ask for. */
export function generateMap(
  opts: GenerateOptions,
  now: string = new Date().toISOString(),
): GalaxyDoc {
  const skin = mapSkinFor(opts);
  const { layout } = opts;
  if (layout !== "realstars") {
    if (skin === "territories") {
      return generateTerritories({ ...opts, layout }, now);
    }
    if (skin === "cities") return generateCities({ ...opts, layout }, now);
  }
  return generateGalaxy({ ...opts, skin }, now);
}

/**
 * True when a document is drawn as stars in space: no land under it, and no
 * style that says otherwise. A hand-made land map is a Theatre document with a
 * terrain, so the style alone does not answer this.
 */
export function drawsAsGalaxy(
  doc: Pick<GalaxyDoc, "theme" | "terrain">,
): boolean {
  return !doc.terrain && (doc.theme?.skin ?? "galaxy") === "galaxy";
}

/** Seas whose worlds have rivers. */
const RIVER_SEAS: readonly string[] = ["water", "acid", "ice"];

/**
 * Room round every location that rivers keep out of, in pixels of the
 * extended picture: as much as the smallest town reaches, so every town has
 * dry ground to stand on. A bigger town is kept off the river where it is
 * drawn (`planTowns`), so it stands on the bank.
 */
function townRoom(doc: GalaxyDoc, mapPixels: number, margin: number) {
  const worldPerMapUnit = playExtentFor(doc.nodes.length) / TERRAIN_MAP_UNITS;
  // As the routing grid and the view read the heights: pixel i is at map
  // i / (pixels - 1) of the way across.
  const pixelsPerMapUnit = (mapPixels - 1) / TERRAIN_MAP_UNITS;
  const radius =
    ((OUTPOST_RADIUS * TOWN_EDGE_MOST) / worldPerMapUnit) * pixelsPerMapUnit +
    1.5;
  return doc.nodes.map((n) => ({
    x: n.pos[0] * pixelsPerMapUnit + margin,
    y: n.pos[1] * pixelsPerMapUnit + margin,
    radius,
  }));
}

/**
 * The land of a generated Cities or Territories document, as the pixels the
 * strategic view takes in place of the document's `generated:` markers.
 * Undefined for every other document. Rebuilding the land is slow enough to
 * notice, so callers memoise this on the document.
 *
 * It carries the land on past the map's edge too, as far as the view's
 * furthest zoom needs. The map's own pixels are the same as without it.
 */
export function generatedTerrainPixels(
  doc: GalaxyDoc,
): TerrainPixels | undefined {
  const built = generatedTerrainWithMargin(
    doc,
    terrainMarginPixels(doc.nodes.length, TERRAIN_PIXELS),
  );
  if (!built) return undefined;
  const { terrain } = built;
  const { width, height } = terrain;
  const wide = extendTerrain(terrain, built.margin);
  // Shading only: the heights above stay the pinned ones. A cratered world is
  // dry, and gullies would cut through the rims.
  const planet = planetOf(terrain.planet);
  const relief = planet.craters
    ? wide.relief
    : erodeRelief(
        wide.relief,
        wide.width,
        wide.height,
        doc.generated?.seed ?? 0,
      );
  // Rivers run on the eroded heights, so they lie in the valleys the light
  // shows. The water is the pinned heights' alone, since a gully can be cut
  // to 0 where the view still draws land. Only a world with water or acid in
  // its seas, or ice, has rivers: a cratered one is dry, nothing rains lava,
  // and a dry basin has nothing to rain.
  const rivers = RIVER_SEAS.includes(planet.sea.look)
    ? findRivers(
        relief.map((v, i) => (wide.relief[i] > 0 ? Math.max(v, 1e-6) : 0)),
        wide.width,
        wide.height,
        desertShare(wide.biomes.a, wide.biomes.b, planet),
        townRoom(doc, width, wide.margin),
      )
    : [];
  // Each river cuts its own valley into the heights the light comes from.
  const lit =
    rivers.length > 0
      ? carveValleys(relief, wide.width, wide.height, rivers)
      : relief;
  return {
    color: { data: terrain.image, width, height },
    height: { data: terrain.heightmap, width, height },
    biomes: { ...terrain.biomes, width, height, planet: terrain.planet },
    // In the map's own pixels, so less the margin.
    rivers: rivers.map(({ points }) => {
      const course = points.slice();
      for (let k = 0; k < course.length; k += 3) {
        course[k] -= wide.margin;
        course[k + 1] -= wide.margin;
      }
      return course;
    }),
    extension: {
      margin: wide.margin,
      image: { data: wide.image, width: wide.width, height: wide.height },
      heights: { data: wide.heights, width: wide.width, height: wide.height },
      relief: { data: lit, width: wide.width, height: wide.height },
      rivers:
        rivers.length > 0
          ? riverEdgePixels(rivers, wide.width, wide.height)
          : undefined,
      biomes: {
        ...wide.biomes,
        width: wide.width,
        height: wide.height,
        planet: terrain.planet,
      },
    },
  };
}

/** The content environment a reroll resolves at call time (never persisted). */
export interface RegenerateEnv {
  maps: GenMap[];
  names?: ConquestNames;
}

/**
 * Reroll a generated map in place: same id, title, style and generation
 * knobs, new seed, content environment re-resolved by the caller. Returns null
 * for docs without persisted knobs (authored maps, or generated ones saved
 * before the knobs existed).
 */
export function regenerateGalaxy(
  galaxy: GalaxyDoc,
  env: RegenerateEnv,
  seed: number,
  now: string = new Date().toISOString(),
): GalaxyDoc | null {
  const g = galaxy.generated;
  if (!g || g.nodeCount === undefined || g.factionCount === undefined) {
    return null;
  }
  const doc = generateMap(
    {
      seed,
      game: galaxy.game,
      maps: env.maps,
      nodeCount: g.nodeCount,
      factionCount: g.factionCount,
      layout: g.layout,
      radiusLy: g.radiusLy,
      skin: g.skin,
      startingSystems: g.startingSystems,
      fogOfWar: g.fogOfWar,
      threatLevel: g.threatLevel,
      startPosition: g.startPosition,
      planet: g.planet,
      names: env.names,
      id: galaxy.id,
      title: galaxy.title,
    },
    now,
  );
  return { ...doc, createdAt: galaxy.createdAt };
}
