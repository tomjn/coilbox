import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

/**
 * The Storage page's category and cache names, by the stable id Rust sends
 * beside its English label. A new id shows Rust's label until it is added here.
 * The ids are in `storage.rs` (`tally` calls) and `caches.rs` (`CACHE_SUBDIRS`).
 */
export const CATEGORY_LABELS: Record<string, MessageDescriptor> = {
  engines: msg`Engines`,
  games: msg`Games`,
  maps: msg`Maps`,
  replays: msg`Replays`,
  saves: msg`Saves`,
  rapidPool: msg`Rapid pool`,
  other: msg`Other`,
};

export const CACHE_LABELS: Record<string, MessageDescriptor> = {
  "coilbox-unitsync-thumbs": msg`Map thumbnails`,
  "coilbox-unitsync-headers": msg`Game headers`,
  "coilbox-unitsync-buildpics": msg`Unit build icons`,
  "coilbox-unitsync-faction-logos": msg`Faction logos`,
  "coilbox-unitsync-info": msg`Game and map info`,
  "coilbox-hub-assets": msg`Unit renders`,
  "coilbox-branding": msg`Branding catalog`,
  "coilbox-branding-images": msg`Branding images`,
  "coilbox-replay-grids": msg`Replay map pictures`,
  "coilbox-replay-unit-orders": msg`Replay unit totals`,
};

type Translate = (d: MessageDescriptor) => string;

export function categoryLabel(
  t: Translate,
  c: { id: string; label: string },
): string {
  const d = CATEGORY_LABELS[c.id];
  return d ? t(d) : c.label;
}

export function cacheLabel(
  t: Translate,
  c: { name: string; label: string },
): string {
  const d = CACHE_LABELS[c.name];
  return d ? t(d) : c.label;
}
