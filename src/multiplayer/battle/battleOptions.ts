import type { ConfigOption } from "@/content/bindings";

/** Engine script-tag prefixes for the two option scopes + the start-pos tag. */
export const MODOPT_PREFIX = "game/modoptions/";
export const MAPOPT_PREFIX = "game/mapoptions/";
export const STARTPOSTYPE_KEY = "game/startpostype";

export type OptionScope = "mod" | "map";

const prefixFor = (scope: OptionScope) =>
  scope === "mod" ? MODOPT_PREFIX : MAPOPT_PREFIX;

/** The full script-tag key for a scoped option, e.g. `game/modoptions/maxunits`. */
export const scriptTagKey = (scope: OptionScope, key: string) =>
  `${prefixFor(scope)}${key}`;

/** Case-insensitive lookup of a script tag (SPADS lowercases; engine is CI). */
export function lookupTag(
  scriptTags: Record<string, string>,
  tagKey: string,
): string | undefined {
  const want = tagKey.toLowerCase();
  for (const [k, v] of Object.entries(scriptTags)) {
    if (k.toLowerCase() === want) return v;
  }
  return undefined;
}

/** The current value set for a scoped option, or undefined if unset. */
export const optionValue = (
  scriptTags: Record<string, string>,
  scope: OptionScope,
  key: string,
): string | undefined => lookupTag(scriptTags, scriptTagKey(scope, key));

/**
 * Raw `{ key, value }` pairs for a scope — the read-only fallback when we have no
 * schema (content not installed) but the host has set options.
 */
export function rawOptionEntries(
  scriptTags: Record<string, string>,
  scope: OptionScope,
): { key: string; value: string }[] {
  const prefix = prefixFor(scope);
  return Object.entries(scriptTags)
    .filter(([k]) => k.toLowerCase().startsWith(prefix))
    .map(([k, value]) => ({ key: k.slice(prefix.length), value }));
}

/**
 * Keep only the option script tags (mod/map options + start-pos type) from a
 * battle's full script-tag map. Presets and option snapshots must never carry the
 * other tags a battle holds — unit restrictions, sync hashes, start rects — so
 * those are filtered out here.
 */
export function battleOptionTags(
  scriptTags: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(scriptTags)) {
    const low = k.toLowerCase();
    if (
      low.startsWith(MODOPT_PREFIX) ||
      low.startsWith(MAPOPT_PREFIX) ||
      low === STARTPOSTYPE_KEY
    ) {
      out[k] = v;
    }
  }
  return out;
}

/** How many of `options` are set away from their default. */
export function changedCount(
  options: ConfigOption[],
  scriptTags: Record<string, string>,
  scope: OptionScope,
): number {
  return options.filter((o) => {
    const v = optionValue(scriptTags, scope, o.key);
    return v !== undefined && v !== (o.default ?? "");
  }).length;
}

/**
 * Whether the local user may edit options: they founded the battle, or the host
 * is an autohost bot (we send `!bSet`; the autohost still enforces privilege).
 */
export const canEditBattleOptions = (isFounder: boolean, hostIsBot: boolean) =>
  isFounder || hostIsBot;

/** One in-flight edit: the value we asked for and the confirmed value at the time. */
export interface PendingEdit {
  target: string;
  prev: string;
}
/** Pending edits keyed by lowercased script-tag key. */
export type PendingMap = Record<string, PendingEdit>;

/** Drop pending edits the server has echoed (confirmed value moved off `prev`). */
export function reconcilePending(
  pending: PendingMap,
  scriptTags: Record<string, string>,
): PendingMap {
  const next: PendingMap = {};
  for (const [tagKey, edit] of Object.entries(pending)) {
    const confirmed = lookupTag(scriptTags, tagKey) ?? "";
    if (confirmed === edit.prev) next[tagKey] = edit; // no echo yet
  }
  return next;
}

/**
 * The value to display for a scoped option: the pending target if in flight, else
 * the confirmed value, else undefined (so the field shows its default).
 */
export function displayedValue(
  pending: PendingMap,
  scriptTags: Record<string, string>,
  scope: OptionScope,
  key: string,
): string | undefined {
  const tagKey = scriptTagKey(scope, key).toLowerCase();
  const p = pending[tagKey];
  if (p) return p.target;
  return optionValue(scriptTags, scope, key);
}
