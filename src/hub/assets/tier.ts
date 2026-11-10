import { getProfile } from "../../profile/profile";

/**
 * The one place that turns a hub asset into a URL (issue #1637).
 *
 * The hub stores `asset.path` tier relative and never fully qualified, so where
 * the bytes are served from is not in its database and moving them is not a
 * migration. It is one value on each side, and this is coilbox's copy of the
 * one in the hub's `lib/assets/cdn.ts`.
 *
 * Two layers rather than the three `../config.ts` gives the hub address: a
 * built-in default, and a profile override for a distributor running their own
 * hub. There is no user setting because there is no reason for a player to move
 * their assets somewhere the hub they read from does not serve, and a setting
 * with no control behind it is one nobody can reach anyway. Layering one on is
 * the same shape as `resolveHubUrl` if that turns out to be wrong.
 */

/** Which store holds an asset, as the hub's `asset.tier` column names it. */
export type AssetTier = "static" | "bucket";

/**
 * The durable tier: https://github.com/tomjn/coilbox-assets through GitHub
 * Pages, which is off Vercel's meters entirely.
 *
 * A subpath rather than a domain root, so `/coilbox-assets` is part of the base
 * and joining must not drop it.
 */
export const DEFAULT_ASSET_CDN_BASE = "https://tomjn.github.io/coilbox-assets/";

/**
 * The durable tier base, always with exactly one trailing slash so joining is a
 * concatenation and nothing has to guess.
 *
 * Never throws. A blank override is unset rather than an error, the same way
 * {@link resolveHubUrl} treats one, so a profile that ships an empty string
 * behaves like a profile that never mentioned it.
 */
export function resolveAssetCdnBase(profileBase?: string): string {
  const base = profileBase?.trim() || DEFAULT_ASSET_CDN_BASE;
  return `${base.replace(/\/+$/, "")}/`;
}

/**
 * The absolute URL for a picture the hub answered with.
 *
 * A `static` row is `path` joined to the configured durable base, and the hub's
 * `hubUrl` for it is ignored, so a distributor's own base is honoured. A
 * `bucket` row is `hubUrl`: the staging bucket is private and the hub serves its
 * bytes from its own route, so there is no path a client could join to a base.
 *
 * Joined by concatenation rather than with `new URL(path, base)`, which
 * resolves the path against the origin: a path starting with a slash would come
 * back with the `/coilbox-assets` segment eaten, and one that looked like a URL
 * of its own would come back as that URL. Concatenating gives a 404 in both
 * cases, which the ladder in `./picture.ts` can fall through.
 */
export function assetTierUrl(
  tier: AssetTier,
  path: string,
  cdnBase: string,
  hubUrl: string,
): string {
  if (tier === "bucket") return hubUrl;
  return cdnBase + path.replace(/^\/+/, "");
}

/** The durable tier this session reads from: the profile's, or the default. */
export function assetCdnBase(): string {
  return resolveAssetCdnBase(getProfile().hubAssetsUrl);
}
