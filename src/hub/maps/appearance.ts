/**
 * The hub's answer in the shape the local appearance cache holds (issue #1739).
 *
 * `src/content/mapAppearance.ts` is the one map classification coilbox has:
 * `spaceMapNames()` picks out the maps with `voidWater`, and the conquest galaxy
 * draws those nodes as asteroids rather than planets. It reads a cache filled as
 * a side effect of rendering a minimap, so it knows about maps this machine has
 * extracted and nothing else, and a galaxy built from maps nobody here has
 * installed gets planets where it should get asteroids.
 *
 * The catalog answers that from a name alone. This fills the same
 * {@link MapAppearance} the cache holds rather than a special case for one
 * boolean, which is what the cache's own doc asks for: the next consumer of it,
 * wanting the wind or the water colours, gets the fallback for free.
 *
 * ## Where the fields come from
 *
 * The measurements are columns on the hub's row. The colours are the
 * `appearance` blob, which coilbox itself wrote when it submitted the map: the
 * worker builds that blob under the names `mapinfo.lua` uses, and those are the
 * names this interface uses too, so the two line up field for field rather than
 * by a translation table. See `appearance_blob` in
 * `crates/coilbox-unitsync-worker/src/mapcatalog.rs`.
 */

import type { MapAppearance } from "@/mapconv/bindings";
import type { MapFacts } from "./lookup";

function flag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A colour is three finite numbers and nothing else, so a blob carrying
 *  something odd under a colour's name is read as no colour. */
function colour(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [r, g, b] = value;
  return [r, g, b].every((c) => typeof c === "number" && Number.isFinite(c))
    ? [r as number, g as number, b as number]
    : null;
}

/**
 * What the hub knows about a map, as an appearance record.
 *
 * Null for a map the hub has never heard of, so a caller can tell "no answer"
 * from "answered, and it is not a void map". That distinction is the whole
 * point: defaulting either way would make an unknown map look like a decided
 * one.
 */
export function appearanceFromFacts(
  facts: MapFacts | null | undefined,
): MapAppearance | null {
  if (!facts) return null;
  const blob = facts.appearance ?? {};
  return {
    name: facts.display_name,
    description: facts.description,
    author: facts.authors[0]?.name ?? null,
    version: null,
    minHeight: facts.world_height_min,
    maxHeight: facts.world_height_max,
    voidWater: facts.void_water,
    voidGround: flag(blob.voidGround),
    voidAlphaMin: number(blob.voidAlphaMin),
    waterColor: colour(blob.waterColor),
    waterAlpha: number(blob.waterAlpha),
    waterPlaneColor: colour(blob.waterPlaneColor),
    waterAbsorb: colour(blob.waterAbsorb),
    waterBaseColor: colour(blob.waterBaseColor),
    waterMinColor: colour(blob.waterMinColor),
    forceRendering: flag(blob.forceRendering),
    skyColor: colour(blob.skyColor),
    fogColor: colour(blob.fogColor),
    cloudColor: colour(blob.cloudColor),
    cloudDensity: number(blob.cloudDensity),
    sunDir: colour(blob.sunDir),
    sunColor: colour(blob.sunColor),
    groundAmbientColor: colour(blob.groundAmbientColor),
    groundDiffuseColor: colour(blob.groundDiffuseColor),
    groundSpecularColor: colour(blob.groundSpecularColor),
    groundShadowDensity: number(blob.groundShadowDensity),
    // The skybox is a path inside the archive, so it means nothing to a machine
    // that has not got the archive. The catalog does not carry it either.
    skyBox: null,
  };
}
