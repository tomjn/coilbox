import { mapconvThumbUrl } from "../lib/assetUrl";
import { mcHeightField, mcImageInfo } from "./bindings";
import type { HeightWords } from "./heightGrid";

/**
 * A process-lifetime cache for `mcImageInfo`. The Rust command re-decodes and
 * re-thumbnails the source image on every call — slow for a large texture — and
 * the preview components run it in mount effects, so without this every
 * navigation regenerated the same thumbnail from scratch.
 *
 * Keyed by `path|max`, it caches the in-flight promise (so concurrent callers —
 * e.g. the asset preview and the 3D preview — share one decode) and its result
 * for the rest of the session. Failures are evicted so they can be retried.
 *
 * In-memory only, saving the round trip rather than the decode: the Rust side
 * keeps the thumbnail itself on disk. Use `invalidateImage` when a file at a
 * known path has been rewritten.
 *
 * `thumb` here is a `src` either way. The command names a cache file the webview
 * loads over the asset protocol, and only inlines the picture where it had
 * nowhere to write it, so resolving the two into one string is done once here
 * rather than at every preview.
 */

type ImageInfo = { width: number; height: number; thumb: string };

const cache = new Map<string, Promise<ImageInfo>>();

export function getImageInfo(path: string, max?: number): Promise<ImageInfo> {
  const key = `${path}|${max ?? ""}`;
  let p = cache.get(key);
  if (!p) {
    p = mcImageInfo({ path, max }).then((info) => ({
      width: info.width,
      height: info.height,
      thumb: info.thumbFile
        ? mapconvThumbUrl(info.thumbFile)
        : (info.thumb ?? ""),
    }));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/**
 * A heightmap's samples as the engine's own 16 bit words (issue #1730).
 *
 * Its own cache beside the thumbnails because it is a different read for a
 * different job: a thumbnail is a picture, and a browser flattens a picture to
 * eight bits a channel on the way in, so terrain displaced from one comes out as
 * contour rings rather than slopes.
 *
 * The words are little endian on disk, which is what a `Uint16Array` over the
 * buffer reads on every platform coilbox ships on.
 */
const grids = new Map<string, Promise<HeightWords>>();

export function getHeightWords(
  path: string,
  max: number,
): Promise<HeightWords> {
  const key = `${path}|${max}`;
  let p = grids.get(key);
  if (!p) {
    p = mcHeightField({ path, max }).then(async (grid) => {
      const bytes = await (
        await fetch(mapconvThumbUrl(grid.file))
      ).arrayBuffer();
      if (bytes.byteLength !== grid.width * grid.height * 2) {
        throw new Error("the heights on disk are not the grid they say");
      }
      return {
        width: grid.width,
        height: grid.height,
        words: new Uint16Array(bytes),
      };
    });
    p.catch(() => grids.delete(key));
    grids.set(key, p);
  }
  return p;
}

/** Drop every cached size for `path` (e.g. after the file is regenerated). */
export function invalidateImage(path: string) {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${path}|`)) cache.delete(key);
  }
  for (const key of [...grids.keys()]) {
    if (key.startsWith(`${path}|`)) grids.delete(key);
  }
}
