import { generateCities } from "./cities";
import type { TerrainPixels } from "./galaxy3d/terrainLoad";
import { type GenerateOptions, type GenMap, generateGalaxy } from "./generate";
import type { GalaxyDoc, MapSkin } from "./model";
import type { ConquestNames } from "./names";
import { generatedTerrain, generateTerritories } from "./territories";

/**
 * The four map styles a player can generate (issue #3507), and the one place
 * that turns a style into the generator that builds it. The wizard, a reroll,
 * a challenge import and the hub's preview all generate through
 * {@link generateMap}, so a style means the same map in each of them.
 */

/** The style choices, in the order both setup forms offer them. */
export const MAP_STYLE_OPTIONS: { value: MapSkin; label: string }[] = [
  { value: "galaxy", label: "Galaxy (stars in space)" },
  { value: "theatre", label: "Theatre (flat chart)" },
  { value: "cities", label: "Cities (roads across generated land)" },
  { value: "territories", label: "Territories (provinces on generated land)" },
];

/** What a style calls one of its locations, for player-facing text. */
export interface LocationNoun {
  one: string;
  many: string;
}

const LOCATION_NOUNS: Record<MapSkin, LocationNoun> = {
  galaxy: { one: "system", many: "systems" },
  theatre: { one: "location", many: "locations" },
  cities: { one: "city", many: "cities" },
  territories: { one: "province", many: "provinces" },
};

export function locationNoun(skin: MapSkin | undefined): LocationNoun {
  return LOCATION_NOUNS[skin ?? "galaxy"];
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

/**
 * The land of a generated Cities or Territories document, as the pixels the
 * strategic view takes in place of the document's `generated:` markers.
 * Undefined for every other document. Rebuilding the land is slow enough to
 * notice, so callers memoise this on the document.
 */
export function generatedTerrainPixels(
  doc: GalaxyDoc,
): TerrainPixels | undefined {
  const terrain = generatedTerrain(doc);
  if (!terrain) return undefined;
  const { width, height } = terrain;
  return {
    color: { data: terrain.image, width, height },
    height: { data: terrain.heightmap, width, height },
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
      names: env.names,
      id: galaxy.id,
      title: galaxy.title,
    },
    now,
  );
  return { ...doc, createdAt: galaxy.createdAt };
}
