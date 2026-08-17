import { mapconvThumbUrl } from "../lib/assetUrl";
import { mcImageInfo } from "./bindings";

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

/** Drop every cached size for `path` (e.g. after the file is regenerated). */
export function invalidateImage(path: string) {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${path}|`)) cache.delete(key);
  }
}
