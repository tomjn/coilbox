import type { MapSize, MissingMapPicture } from "./placeholder";
import { type AssetTier, assetTierUrl } from "./tier";

/**
 * Where a picture of a map comes from, in the order to try (issue #1637).
 *
 * The hub browser lists presets, challenges, packs and scenarios for maps the
 * reader may not own. Coilbox draws minimaps out of local archives through
 * unitsync, so for a map that is not installed there is nothing to draw, and the
 * page had the map's name and nothing else.
 *
 * ## The ladder
 *
 * 1. The local archive, through unitsync.
 * 2. The hub's durable tier, on GitHub Pages.
 * 3. The hub's staging tier, for anything approved but not promoted yet.
 * 4. Beyond All Reason's own preview thumbnail.
 * 5. A drawing of the map's outline, which cannot fail.
 *
 * Local comes first, which is the reverse of the hub's own order in
 * `lib/assets/resolve.ts` and deliberate. An installed archive costs no request,
 * works with no network at all, and is the exact map the reader will play rather
 * than a picture of something with the same name.
 *
 * Rungs two and three fill up from the seed export and from nothing else. There
 * is no client upload path for a map picture and none is planned, so a map
 * nobody has seeded stays on rung four or five however many people open it. That
 * is issue #1685, and section 4.6.1 of the asset pipeline design carries the
 * reasoning.
 *
 * Two and three are one row rather than two attempts, exactly as the hub says:
 * there is one row per identity and its `tier` column says which store holds it,
 * so the order between them is a fact about promotion rather than a race.
 *
 * ## Why BAR sits below both hub tiers rather than above them
 *
 * It is the one remote source coilbox has today and it is the only rung with any
 * data in it, since the hub holds no minimaps until somebody runs the seed. It
 * is still last before the drawing, because it is a compatibility rung and not a
 * peer: it answers only for the maps BAR certifies, and it hands back BAR's
 * preview thumbnail rather than the minimap the asset vocabulary names. Anything
 * the hub itself holds is the picture that was asked for, at known dimensions,
 * for any game in the ecosystem, which is the point of coilbox not being a BAR
 * launcher. When the hub holds minimaps this rung stops answering for the maps
 * that matter without anything above it changing.
 *
 * The hub puts BAR ahead of its own tiers, on cost: its staging tier spends Blob
 * data transfer out of 10 GB a month and BAR serves from its own proxy. That
 * argument is about a public website's traffic. One desktop client showing one
 * map in a battle room or on an item page is not that, and paying a few
 * kilobytes for the right picture is the better trade here.
 *
 * ## Nothing supplies the hub rungs yet
 *
 * {@link MapPictureSources.held} is always null in the app today. The hub has no
 * public route that answers "what do you hold for this identity" with a path:
 * `/api/v1/assets/have` needs a bearer token and answers `have`, `changed` or
 * `missing` without one. The rungs are here, and tested, because the tier bases
 * and the row's shape are both settled and published, so what is left is a wire
 * rather than a design. Issue #1687 is that wire.
 */

/** Which rung answered. The two hub tiers keep their own names, because which
 *  one served a picture is the difference between a request that costs the hub
 *  nothing and one that spends its Blob allowance. */
export type MapPictureFrom = AssetTier | "local" | "bar" | "placeholder";

/** What the hub holds for one map, off its `asset` row. */
export interface HeldMapAsset {
  tier: AssetTier;
  /** Tier relative, never a fully qualified URL. */
  path: string;
  /** The encoded picture's own pixels, so an `<img>` can carry its proportions
   *  and not reshape the page when it loads. */
  width: number;
  height: number;
}

/** A picture that exists somewhere, at a URL. */
export interface FetchedMapPicture {
  from: Exclude<MapPictureFrom, "placeholder">;
  url: string;
  /** The picture's own pixels where the source knew them, and null where it did
   *  not. unitsync renders a map into a square texture, so a local minimap's
   *  pixels are not the map's proportions and are deliberately absent. */
  width: number | null;
  height: number | null;
}

/** Nothing anywhere has a picture, so it is drawn. See `./placeholder.ts`. */
export type DrawnMapPicture = { from: "placeholder" } & MissingMapPicture;

export type MapPicture = FetchedMapPicture | DrawnMapPicture;

/** Everything the ladder can draw on. Every field but the name and the base is
 *  something that may be absent, which is what the ladder is for. */
export interface MapPictureSources {
  /** The map's full name, version and all, never split. */
  mapName: string;
  /** unitsync's render of the installed archive, or null when it is not
   *  installed or has not rendered yet. */
  local?: string | null;
  /** What the hub holds for `(mapName, "minimap")`, or null. */
  held?: HeldMapAsset | null;
  /** BAR's preview thumbnail for this spring name, or null for a map it does
   *  not certify. */
  bar?: string | null;
  /** The map's size, for the drawing at the bottom. Null draws a square. */
  size?: MapSize | null;
  /** The durable tier base, from `assetCdnBase()`. */
  cdnBase: string;
}

/**
 * Every picture of this map worth trying, best first, ending in the drawing.
 *
 * The whole ladder rather than only the best of it, so a rung that fails to load
 * demotes to the next one instead of leaving a broken image. Never empty: the
 * last entry has no URL and so can never fail.
 */
export function mapPictureLadder(sources: MapPictureSources): MapPicture[] {
  const ladder: MapPicture[] = [];

  if (sources.local) {
    ladder.push({
      from: "local",
      url: sources.local,
      width: null,
      height: null,
    });
  }

  const held = sources.held;
  if (held) {
    ladder.push({
      from: held.tier,
      url: assetTierUrl(held.tier, held.path, sources.cdnBase),
      width: held.width,
      height: held.height,
    });
  }

  if (sources.bar) {
    ladder.push({ from: "bar", url: sources.bar, width: null, height: null });
  }

  ladder.push({
    from: "placeholder",
    name: sources.mapName,
    size: sources.size ?? null,
  });

  return ladder;
}

/**
 * The rung to draw, given the URLs that have already failed to load.
 *
 * Keyed on the URLs rather than on a position, because the ladder is rebuilt
 * whenever one of its sources arrives - BAR's list loads after the first render,
 * and a map finishes scanning after that - and a remembered index would then
 * point at a different rung than the one that failed.
 *
 * Always answers. The drawing has no URL, so it is never in `failed`.
 */
export function shownMapPicture(
  ladder: MapPicture[],
  failed: ReadonlySet<string>,
): MapPicture {
  const showing = ladder.find(
    (rung) => rung.from === "placeholder" || !failed.has(rung.url),
  );
  // `mapPictureLadder` always ends in the drawing, so the find cannot miss. The
  // fallback is for a caller that built a ladder some other way.
  return showing ?? { from: "placeholder", name: "", size: null };
}

/** What to caption a picture with, which depends on whose it is: BAR's preview
 *  is a thumbnail of the map rather than a minimap of it, and saying "minimap"
 *  over it would be labelling somebody else's picture as ours. */
export function mapPictureAlt(picture: MapPicture, mapName: string): string {
  if (picture.from === "placeholder") return "";
  return picture.from === "bar"
    ? `Preview of ${mapName}`
    : `Minimap of ${mapName}`;
}
