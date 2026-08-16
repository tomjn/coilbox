/**
 * Asking the hub which pictures it holds, and where they are (issue #1687).
 *
 * `POST <hub>/api/v1/assets/pictures`, the question `/api/v1/assets/have` is
 * not. The have check decides whether to upload: it wants a `source_hash` per
 * key, answers without a path, and needs a bearer token. This one decides what
 * to show, so it takes no hash, answers with a path, and needs no token at all.
 *
 * A caller has to be told the path rather than working it out. The hub derives
 * `asset.path` from the sha256 of the encoded bytes and adds a random suffix to
 * anything still in the staging tier, so a client that does not hold the bytes
 * cannot derive either.
 *
 * ## Why this is a webview fetch and not a plugin command
 *
 * The same reasons `../api.ts` fetches the item routes here: the hub sends
 * `access-control-allow-origin: *`, this is a plain read of a JSON API, and the
 * caller is the page drawing the picture. The have check is in Rust because its
 * caller is the Rust upload path and it needs a token off the keychain. This
 * route needs no token, so a plugin command would be an ACL entry, a permission
 * file and a serde round trip in front of a `fetch` the webview can make itself.
 *
 * ## Why a failure is "no picture" rather than an error
 *
 * The caller has a ladder underneath this (`./picture.ts`) that ends in a
 * drawing, so the honest render for "the hub could not say" is the same
 * placeholder it would draw anyway. The reason is returned rather than thrown so
 * a caller that wants to say something can, and so the tests can read it.
 */

import { serverError } from "../api";
import type { AssetIdentity } from "./have";
import type { AssetTier } from "./tier";

/** The envelope, from `lib/api/assetPictures.ts` in tomjn/coilbox-hub. */
const PICTURES_FORMAT = "coilbox-hub-asset-pictures";

/** The version this build was written against. A higher one is refused rather
 *  than read as a shape that changed underneath a build sitting on disk. */
export const ASSET_PICTURES_VERSION = 1;

/**
 * How many keys one request may carry, which is the hub's own
 * `ASSET_PICTURES_MAX_KEYS`. Over it the hub refuses the whole batch with a 413,
 * so the number is honoured here rather than discovered: {@link fetchHubPictures}
 * splits a larger set into requests of this size, the same way `have.rs` does.
 */
export const MAX_PICTURE_KEYS = 500;

/**
 * Where one picture is, as the hub answers.
 *
 * `path` is tier relative, exactly as the row stores it, so it is joined to
 * whichever base this session is configured with. `url` is the hub joining it to
 * its own bases, which coilbox does not use for a map: `./tier.ts` carries a
 * profile override for a distributor serving assets from somewhere else, and
 * taking the hub's URL would ignore it.
 */
export interface AssetPicture {
  tier: AssetTier;
  path: string;
  url: string;
  /** The encoded image's own pixels, so an `<img>` can carry its proportions and
   *  not reshape the page when it loads. */
  width: number;
  height: number;
  /**
   * Which variant the bytes are actually of. The hub stands a unit's buildpic in
   * for a render angle it has not got, so a caller that assumed it got the angle
   * it asked for would caption somebody's icon as a view from above.
   */
  served_variant: string;
  substituted: boolean;
}

/** Either the answers, in the order the keys were asked, or a sentence saying
 *  why there are none. */
export type PicturesResult =
  | { ok: true; pictures: (AssetPicture | null)[] }
  | { ok: false; reason: string };

/** The lookup's address under the configured base, concatenated rather than
 *  resolved so a hub served under a path prefix keeps its prefix. */
export function hubPicturesUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}/api/v1/assets/pictures`;
}

/** The identity as the hub reads it back, so an answer can be checked against
 *  the key it claims to be about. */
function echoes(
  identity: AssetIdentity,
  result: Record<string, unknown>,
): boolean {
  if (result.keyed_on !== identity.keyed_on) return false;
  if (result.variant !== identity.variant) return false;
  return identity.keyed_on === "map"
    ? result.map_name === identity.map_name
    : result.game === identity.game && result.unit_name === identity.unit_name;
}

/** One answer's picture, or null for anything that is not one. A result whose
 *  picture is malformed is read as no picture, because the caller's fallback is
 *  what it would draw for a missing one anyway. */
function readPicture(value: unknown): AssetPicture | null {
  if (typeof value !== "object" || value === null) return null;
  const picture = value as Record<string, unknown>;
  if (picture.tier !== "static" && picture.tier !== "blob") return null;
  if (typeof picture.path !== "string" || !picture.path) return null;
  if (typeof picture.width !== "number" || typeof picture.height !== "number") {
    return null;
  }
  return {
    tier: picture.tier,
    path: picture.path,
    url: typeof picture.url === "string" ? picture.url : "",
    width: picture.width,
    height: picture.height,
    served_variant:
      typeof picture.served_variant === "string" ? picture.served_variant : "",
    substituted: picture.substituted === true,
  };
}

/**
 * Read one batch's answer, given the keys it was asked with.
 *
 * The count and the echoed key are both checked before anything is read by
 * index. The hub answers in request order, which is what makes an answer
 * readable by position, and a batch that came back reordered or short would put
 * one map's picture on another map's card. That is worse than no picture, so it
 * is refused whole.
 */
export function readPicturesBody(
  body: unknown,
  asked: AssetIdentity[],
): PicturesResult {
  if (typeof body !== "object" || body === null) {
    return {
      ok: false,
      reason: "The hub sent something coilbox could not read.",
    };
  }
  const shape = body as Record<string, unknown>;
  if (shape.format !== PICTURES_FORMAT) {
    return {
      ok: false,
      reason: "That address answered, but it is not a coilbox hub.",
    };
  }
  if (
    typeof shape.version !== "number" ||
    shape.version > ASSET_PICTURES_VERSION
  ) {
    return {
      ok: false,
      reason:
        "This hub answers with a newer picture lookup than this copy of coilbox understands. Update coilbox.",
    };
  }
  const results = shape.results;
  if (!Array.isArray(results) || results.length !== asked.length) {
    return {
      ok: false,
      reason: `The hub answered ${Array.isArray(results) ? results.length : 0} of ${asked.length} keys.`,
    };
  }

  const pictures: (AssetPicture | null)[] = [];
  for (const [index, result] of results.entries()) {
    if (typeof result !== "object" || result === null) {
      return {
        ok: false,
        reason: `The hub's answer ${index} is not a result.`,
      };
    }
    const record = result as Record<string, unknown>;
    if (!echoes(asked[index], record)) {
      return {
        ok: false,
        reason: `The hub answered key ${index} with a different key.`,
      };
    }
    pictures.push(readPicture(record.picture));
  }
  return { ok: true, pictures };
}

/** One request, and what it answered. */
async function ask(
  url: string,
  keys: AssetIdentity[],
  signal?: AbortSignal,
): Promise<PicturesResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ keys }),
      signal,
    });
  } catch {
    return { ok: false, reason: `Could not reach the hub at ${hostOf(url)}.` };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (response.ok) {
      return {
        ok: false,
        reason: "The hub sent something coilbox could not read.",
      };
    }
  }

  if (!response.ok) {
    const said = serverError(body);
    return {
      ok: false,
      reason:
        said ?? `The hub refused the picture lookup (HTTP ${response.status}).`,
    };
  }
  return readPicturesBody(body, keys);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Ask the hub about these identities, answered in the order they were given so a
 * caller can zip the two by index.
 *
 * A set larger than {@link MAX_PICTURE_KEYS} is split into requests of that size
 * and the answers joined back up. One failed request fails the set: a partial
 * answer read by index would line the rest up against the wrong keys.
 *
 * An empty set asks nobody, which matters because the hub refuses an empty batch
 * and because the caller of this is a queue that can flush empty.
 */
export async function fetchHubPictures(
  base: string,
  identities: AssetIdentity[],
  signal?: AbortSignal,
): Promise<PicturesResult> {
  if (identities.length === 0) return { ok: true, pictures: [] };

  const url = hubPicturesUrl(base);
  const pictures: (AssetPicture | null)[] = [];
  for (let at = 0; at < identities.length; at += MAX_PICTURE_KEYS) {
    const batch = identities.slice(at, at + MAX_PICTURE_KEYS);
    const answered = await ask(url, batch, signal);
    if (!answered.ok) return answered;
    pictures.push(...answered.pictures);
  }
  return { ok: true, pictures };
}
