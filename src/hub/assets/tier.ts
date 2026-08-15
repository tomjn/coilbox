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
export type AssetTier = "static" | "blob";

/**
 * The durable tier: https://github.com/tomjn/coilbox-assets through GitHub
 * Pages, which is off Vercel's meters entirely.
 *
 * A subpath rather than a domain root, so `/coilbox-assets` is part of the base
 * and joining must not drop it.
 */
export const DEFAULT_ASSET_CDN_BASE = "https://tomjn.github.io/coilbox-assets/";

/**
 * The staging tier: the hub's `coilbox-staging` Vercel Blob store, holding
 * anything approved but not promoted yet.
 *
 * A constant and not configuration, which is where this deliberately differs
 * from the durable tier. The base is the identity of one store rather than a
 * choice, and the hub says the same in `lib/assets/blob.ts`: a base pointing at
 * a store the hub's own token cannot write to fails as a 404 on every picture
 * rather than as an error anybody notices.
 */
export const BLOB_TIER_BASE =
  "https://eyugwjvmp953ayog.public.blob.vercel-storage.com/";

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
 * The absolute URL for a tier relative `asset.path`.
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
): string {
  const base = tier === "static" ? cdnBase : BLOB_TIER_BASE;
  return base + path.replace(/^\/+/, "");
}

/** The durable tier this session reads from: the profile's, or the default. */
export function assetCdnBase(): string {
  return resolveAssetCdnBase(getProfile().hubAssetsUrl);
}
