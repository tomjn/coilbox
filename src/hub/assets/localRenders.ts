/**
 * The top down renders this machine has already drawn (issue #1724).
 *
 * Coilbox draws a unit from above out of the real model, has the worker encode
 * it, and sends it to the hub. Until now that was the end of it: the encoded file
 * is named after the sha256 of its own bytes, which is the name the hub's object
 * path wants and tells a second reader nothing at all. So a plan of somebody's
 * base drew its buildings out of the hub even on the machine that made the
 * pictures, and with no hub it drew squares.
 *
 * This is the same pictures read back. `./blueprintBackfill.ts` writes a record
 * down as each render is encoded, and a plan asks for the whole layout in one
 * call before it asks the hub anything.
 *
 * ## What this is not
 *
 * Drawing a render for a unit nobody has drawn. That is a GL context per unit and
 * the backfill draws them one at a time on purpose, so a plan of twenty buildings
 * must not become a render pass on a page load. This only finds what was drawn. A
 * unit with no render still keeps its footprint square.
 *
 * ## Staleness
 *
 * `RENDER_VERSION` goes in every ask, so a bump misses every render ever drawn
 * and nothing has to go looking for the stale ones. The game's archive goes in
 * too when the caller knows it, which the backfill always does. A caller that
 * does not know the archive gets the version check alone: see
 * `crates/tauri-plugin-coilbox-unitsync/src/renderindex.rs` for why, and for what
 * that costs.
 */

import {
  type LocalRender,
  type UnitRenderAsset,
  unitsyncLocalRenders,
  unitsyncRememberRender,
} from "@/content/bindings";
import { hubAssetUrl } from "@/lib/assetUrl";
import type { PlanPicture } from "./unitPictures";

/**
 * Write down which unit a just drawn render is of.
 *
 * Best effort and never thrown from. A render that could not be indexed is still
 * a render that was drawn, encoded and offered to the hub, and failing the run
 * over the bookkeeping would be the wrong trade.
 */
export async function rememberLocalRender(
  game: string,
  unit: string,
  asset: UnitRenderAsset,
): Promise<void> {
  try {
    await unitsyncRememberRender({
      game,
      unit,
      variant: asset.variant,
      path: asset.path,
      mime: asset.mime,
      encodeProfile: asset.encodeProfile,
      sourceHash: asset.sourceHash,
      modelDigest: asset.modelDigest,
      sourceArchive: asset.sourceArchive,
      rendererVersion: asset.rendererVersion,
      width: asset.width,
      height: asset.height,
    });
  } catch (e) {
    console.warn("could not remember the render of", unit, e);
  }
}

/**
 * The renders this machine holds for `units`, keyed by the lower cased unit name.
 *
 * One call however many units, and a unit with nothing is absent rather than
 * null, so a caller finds its answer by finding it. An empty map for a machine
 * that has drawn nothing, or a build with no plugin behind the call, which is
 * every test that has not stubbed it.
 */
export async function localRenders(
  game: string,
  variant: string,
  rendererVersion: number,
  units: readonly string[],
  sourceArchive?: string,
): Promise<ReadonlyMap<string, LocalRender>> {
  const names = [...new Set(units.map((unit) => unit.toLowerCase()))];
  if (!game || names.length === 0) return new Map();
  try {
    const found = await unitsyncLocalRenders({
      game,
      variant,
      rendererVersion,
      units: names,
      ...(sourceArchive ? { sourceArchive } : {}),
    });
    return new Map(Object.entries(found.renders ?? {}));
  } catch (e) {
    console.warn("could not read this machine's renders", e);
    return new Map();
  }
}

/**
 * One local render as a plan draws it.
 *
 * Always framed, because a render is what this holds and nothing else: the box a
 * picture is drawn in depends on whether it carries the render bleed and the
 * footprint's aspect, and a build pic standing in for one does not.
 */
export function localPlanPicture(render: LocalRender): PlanPicture {
  return { url: hubAssetUrl(render.file), framed: true };
}
