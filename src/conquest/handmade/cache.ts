import type { ProvincePixels, TracedMap } from "./trace";

/**
 * Where traced maps are kept so a map is traced once. The value is plain JSON
 * and holds no URLs, so a later store can write it to disk as it is.
 */
export interface TraceCache {
  get(key: string): TracedMap | undefined;
  set(key: string, value: TracedMap): void;
}

/** A cache that lasts as long as the app is open. */
export function memoryTraceCache(): TraceCache {
  const entries = new Map<string, TracedMap>();
  return {
    get: (key) => entries.get(key),
    set: (key, value) => {
      entries.set(key, value);
    },
  };
}

/**
 * Bump when the tracer's output changes for the same input, so results kept
 * by an older build are not served.
 */
export const TRACE_VERSION = 1;

/**
 * The cache key for a map: it changes when the manifest text or any pixel of
 * the province image does. The whole manifest is hashed, not only the colour
 * list, so a key never has to be reasoned about: any edit traces again.
 *
 * Two 32-bit hashes run side by side (FNV-1a and a multiply and rotate mix),
 * which is enough to tell versions of one folder apart. It is not a defence
 * against a file built to collide.
 */
export function traceCacheKey(manifest: string, image: ProvincePixels): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  const feed = (byte: number) => {
    a = Math.imul(a ^ byte, 0x01000193);
    b = Math.imul((b << 5) | (b >>> 27), 0x85ebca6b) ^ byte;
  };
  for (let i = 0; i < manifest.length; i++) {
    const unit = manifest.charCodeAt(i);
    feed(unit & 255);
    feed(unit >> 8);
  }
  const { data } = image;
  for (let i = 0; i < data.length; i++) feed(data[i]);
  const hex = (v: number) => (v >>> 0).toString(16).padStart(8, "0");
  return `v${TRACE_VERSION}-${image.width}x${image.height}-${manifest.length}-${hex(a)}${hex(b)}`;
}
