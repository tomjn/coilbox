import { lookupTag } from "./battleOptions";

/**
 * Conversion between a flat disabled-unit set (as the shared `UnitRestrictions`
 * editor speaks) and the engine-native `game/restrict/*` script tags that carry
 * restrictions to joiners. Every restriction here is a full disable (limit 0);
 * there is no per-unit count. Tags: `game/restrict/unit<N>`, `.../limit<N>` and
 * `.../numrestrictions`, with N a 0-based index into the sorted unit set.
 */
const RESTRICT_PREFIX = "game/restrict/";
const NUMRESTRICTIONS_KEY = "game/restrict/numrestrictions";

/** True if `key` is any engine-native unit-restriction tag (case-insensitive). */
const isRestrictKey = (key: string) =>
  key.toLowerCase().startsWith(RESTRICT_PREFIX);

/**
 * The full `game/restrict/*` tag map that disables `disabled` (deduped + sorted
 * for stable indices). Empty set → `{}` (no restriction tags at all).
 */
export function restrictTagsFor(disabled: string[]): Record<string, string> {
  const units = [...new Set(disabled)].sort();
  if (units.length === 0) return {};
  const tags: Record<string, string> = {
    [NUMRESTRICTIONS_KEY]: String(units.length),
  };
  units.forEach((name, i) => {
    tags[`${RESTRICT_PREFIX}unit${i}`] = name;
    tags[`${RESTRICT_PREFIX}limit${i}`] = "0";
  });
  return tags;
}

/** The disabled-unit set carried by `tags`, sorted (ignores empty unit names). */
export function disabledFromTags(tags: Record<string, string>): string[] {
  const units = new Set<string>();
  for (const [k, v] of Object.entries(tags)) {
    if (/^game\/restrict\/unit\d+$/.test(k.toLowerCase()) && v.trim() !== "") {
      units.add(v);
    }
  }
  return [...units].sort();
}

/** The set of script-tag edits (writes) + removals to reach a desired restriction set. */
export interface RestrictTagDiff {
  set: Record<string, string>;
  remove: string[];
}

/**
 * Diff a desired disabled set against the battle's current script tags: `set` =
 * the `game/restrict/*` keys to write (added or changed), `remove` = the now-unused
 * restrict keys to delete. Indices reflow from the sorted set on every change, so a
 * shrunk set leaves stale higher indices (and, at 0, `numrestrictions`) to clear.
 * Non-restrict tags are untouched.
 */
export function diffRestrictTags(
  disabled: string[],
  currentTags: Record<string, string>,
): RestrictTagDiff {
  const desired = restrictTagsFor(disabled);
  const set: Record<string, string> = {};
  for (const [k, v] of Object.entries(desired)) {
    if (lookupTag(currentTags, k) !== v) set[k] = v;
  }
  const desiredLower = new Set(
    Object.keys(desired).map((k) => k.toLowerCase()),
  );
  const remove = Object.keys(currentTags).filter(
    (k) => isRestrictKey(k) && !desiredLower.has(k.toLowerCase()),
  );
  return { set, remove };
}
