/**
 * Pictures of the units a layout names, so a plan can be drawn as its buildings
 * rather than as squares (issue #1721).
 *
 * Coilbox is where these pictures come from. `./renderTop.ts` draws a unit from
 * above out of the real model and its textures, `./blueprintBackfill.ts` has the
 * worker encode it and sends it to the hub, and the website then draws a shared
 * layout as its units. This is the same read back, so the app draws what it
 * uploaded instead of squares.
 *
 * Only what the hub holds. Drawing one here costs a GL context per unit and the
 * backfill deliberately draws them one at a time, so a plan of twenty buildings
 * cannot be a render pass on a page load. A unit the hub has no picture of keeps
 * the footprint square, which is what every building was before this and is the
 * right answer anyway: the shape of the base and the relative size of the things
 * in it are most of what a person recognises a base by.
 *
 * Keyed on the game's modinfo shortname and the unit's internal name, which is
 * what the hub keys a unit picture on and what the backfill uploads under. Lower
 * cased, because a layout carries whatever its author's game wrote and the unit
 * dataset the keys were minted from is lower case.
 */

import type { AssetIdentity } from "./have";
import type { AssetPicture } from "./pictures";
import { assetTierUrl } from "./tier";
import {
  RENDER_VARIANT_PREFIX,
  renderVariant,
  TOP_RENDER_ANGLE,
} from "./vocabulary";

/** One picture to draw on a plan. */
export interface PlanPicture {
  url: string;
  /**
   * Whether the bytes are a top down render, which carries the render bleed and
   * the footprint's aspect, rather than the build pic the hub stands in for one it
   * has not got. It decides the box the picture is drawn in, see `pictureBox` in
   * `../preview.ts`.
   */
  framed: boolean;
}

/** The variant a plan asks for: the view from above. */
export const PLAN_VARIANT = renderVariant(TOP_RENDER_ANGLE);

/** What to ask the hub for one building's picture. */
export function unitPictureIdentity(game: string, def: string): AssetIdentity {
  return {
    keyed_on: "unit",
    game,
    unit_name: def.toLowerCase(),
    variant: PLAN_VARIANT,
  };
}

/**
 * One answer as the plan draws it, or null for a unit the hub holds nothing for.
 *
 * The hub's own `url` is dropped rather than used, the same as `heldMapAsset` in
 * `./heldPictures.ts`: `./tier.ts` joins the path to whichever durable base this
 * session is configured with, and a distributor serving assets from their own is
 * the reason that override exists.
 */
export function planPicture(
  picture: AssetPicture | null,
  cdnBase: string,
): PlanPicture | null {
  if (!picture) return null;
  return {
    url: assetTierUrl(picture.tier, picture.path, cdnBase),
    // What came back rather than what was asked for. A build pic served in place
    // of a render is a three quarter icon, and drawing it in a render's box would
    // scale somebody's icon up by the bleed.
    framed: picture.served_variant.startsWith(RENDER_VARIANT_PREFIX),
  };
}
