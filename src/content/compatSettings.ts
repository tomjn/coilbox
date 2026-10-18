import { useSetting } from "@picoframe/frame";

/** One game's compatibility mode setting (issue #4561). */
export interface CompatEntry {
  enabled: boolean;
  /** The compat manifest the game's mutator was last built from. */
  version: number;
}

/** Compatibility mode per game, keyed by the game's primary archive name. */
export type CompatSettings = Record<string, CompatEntry>;

export function useCompatSettings() {
  return useSetting<CompatSettings>("content.compat", {});
}

/** `settings` with `archive`'s entry set to `entry`. */
export function withCompatEntry(
  settings: CompatSettings,
  archive: string,
  entry: CompatEntry,
): CompatSettings {
  return { ...settings, [archive]: entry };
}

/** `settings` without `archive`'s entry. */
export function withoutCompatEntry(
  settings: CompatSettings,
  archive: string,
): CompatSettings {
  const { [archive]: _removed, ...rest } = settings;
  return rest;
}
