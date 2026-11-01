import { t } from "@lingui/core/macro";
import type { ConfigOption } from "@/content/bindings";
import { changedOptions, isChanged } from "@/play/modOptions";
import type { PresetPart, PresetSelection } from "@/play/presetParts";
import { isTweakSlotKey, tweakSlotOptions } from "@/workshop/deliveryRoutes";
import { RESTRICT_PREFIX } from "./restrictTags";

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

/** A mod or map option's bare name, or null for any other tag. */
function scopedName(tagKey: string): string | null {
  const low = tagKey.toLowerCase();
  return low.startsWith(MODOPT_PREFIX) || low.startsWith(MAPOPT_PREFIX)
    ? tagKey.slice(MODOPT_PREFIX.length)
    : null;
}

/**
 * Whether a tag's key can go on a line as it stands: parts of letters, digits and
 * underscores, the rule `option_refusal` in the play plugin's `script.rs` applies,
 * with one name after a mod or map option's prefix. A longer name would be a mod
 * option to the parts picker and its last part to the `!bSet` route, which sends
 * only that. `script_tag_refusal` in `coilbox-lobby-protocol` is the same check,
 * and the last one before the wire.
 */
function tagKeyFits(tagKey: string): boolean {
  const parts = tagKey.split("/");
  if (!parts.every((part) => /^[A-Za-z0-9_]+$/.test(part))) return false;
  return scopedName(tagKey) === null || parts.length === 3;
}

/**
 * Why a tag cannot be sent, or null when it can.
 *
 * A `SETSCRIPTTAGS` line is pairs split at tabs and nothing escapes them, so a tab
 * in a key or value adds a tag no option listed, which can be a tweak slot. On the
 * `!bSet` route SPADS puts the value on that line itself. A semicolon is refused
 * because the host script refuses it anyway, and SPADS cannot write one beside a
 * quote mark.
 */
export function optionTagRefusal(tagKey: string, value: string): string | null {
  if (!tagKeyFits(tagKey))
    return t`Name is not only letters, digits and underscores`;
  if (value.includes(";")) return t`Contains a semicolon`;
  if (/\p{Cc}/u.test(value))
    return t`Contains a line break or another control character`;
  return null;
}

/** A tag's option name for a message, quoted when the name is the problem so a
 *  tab in it can be seen. */
export function optionTagLabel(tagKey: string): string {
  const name = scopedName(tagKey) ?? tagKey;
  return tagKeyFits(tagKey) ? name : JSON.stringify(name);
}

/** One sentence for the first tag that cannot be sent, or null when all can. */
export function optionTagsRefusal(tags: Record<string, string>): string | null {
  for (const [tagKey, value] of Object.entries(tags)) {
    const reason = optionTagRefusal(tagKey, value);
    if (reason === null) continue;
    const name = optionTagLabel(tagKey);
    return t`Coilbox did not send the room's options: ${name}. ${reason}.`;
  }
  return null;
}

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
 * The tweak slots a battle's host has actually set, keyed the way
 * `workshop_decode_tweak_set` expects: bare mod option names (`tweakdefs`,
 * `tweakunits3`), not the `game/modoptions/` script-tag keys they are stored
 * under (issue #2756).
 *
 * Which options are tweak slots at all comes from `deliveryRoutes.ts`'s own
 * `tweakSlotOptions`, not from matching key names again here. A slot the
 * game declares but nobody has touched carries whatever default the schema
 * gives it, ordinarily an empty string, and empty is filtered out: it is
 * not a payload to decode, it is the absence of one, and a battle with no
 * tweak slots set should end up with an empty map here rather than one full
 * of nothing to show.
 */
export function tweakSetEntries(
  modOptionsSchema: ConfigOption[],
  scriptTags: Record<string, string>,
): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const option of tweakSlotOptions(modOptionsSchema)) {
    const value = optionValue(scriptTags, "mod", option.key);
    if (value) entries[option.key] = value;
  }
  return entries;
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

/**
 * Which preset part a host seed's script tag belongs to, or null when it
 * belongs to none.
 *
 * `draftToHostSeed` builds four kinds of tag: the start-pos type, the draft's
 * mod options, its map options, and the restrict block for its disabled units.
 */
export function partForTag(key: string): PresetPart | null {
  const low = key.toLowerCase();
  if (low === STARTPOSTYPE_KEY) return "startPositions";
  if (low.startsWith(RESTRICT_PREFIX)) return "restrictions";
  if (low.startsWith(MAPOPT_PREFIX)) return "mapOptions";
  if (low.startsWith(MODOPT_PREFIX))
    return isTweakSlotKey(low.slice(MODOPT_PREFIX.length))
      ? "tweakSlots"
      : "modOptions";
  return null;
}

/**
 * Narrow a host seed's script tags to the parts a selection takes, for applying
 * only some of a preset to a battle room.
 *
 * A tag belonging to no part is kept rather than dropped. Filtering is about the
 * parts this knows, and an unrecognised tag is somebody else's to decide on.
 */
export function filterOptionTags(
  tags: Record<string, string>,
  selection: PresetSelection,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    const part = partForTag(key);
    if (part === null || selection.parts.includes(part)) out[key] = value;
  }
  return out;
}

/**
 * Every map option tag a room holds, for removing when its map changes.
 *
 * Map option keys are generic and collide across maps. BlockFort v1 and airport
 * 0.6 both declare `fog`, one wanting it on and the other off, so a value set for
 * one map must not carry over to the next. SPADS does the same job with a blanket
 * wipe in `sendBattleMapOptions`.
 */
export function mapOptionTags(scriptTags: Record<string, string>): string[] {
  return Object.keys(scriptTags).filter((k) =>
    k.toLowerCase().startsWith(MAPOPT_PREFIX),
  );
}

/**
 * How many of `options` are set away from their default, counting an edit in
 * flight the way the fields do.
 */
export function changedCount(
  options: ConfigOption[],
  scriptTags: Record<string, string>,
  scope: OptionScope,
  pending: PendingMap = {},
): number {
  return options.filter((o) =>
    isChanged(o, displayedValue(pending, scriptTags, scope, o.key)),
  ).length;
}

/** One option write: its script tag, the name SPADS knows it by, and the value. */
export interface OptionEdit {
  tagKey: string;
  spadsName: string;
  value: string;
}

/**
 * The writes that put every changed option in `parts` back to the default its
 * game or map declares, counting an edit in flight the way the fields do.
 *
 * The value is the declared default, or empty where there is none. An autohost
 * is sent that value, because only it can write its script. A battle we host
 * withdraws the tag instead and ignores the value, so the start script goes back
 * to leaving the option out. A part is one scope's options, so a section is one
 * part and a tab that holds both scopes is two.
 */
export function resetEdits(
  parts: { scope: OptionScope; options: ConfigOption[] }[],
  scriptTags: Record<string, string>,
  pending: PendingMap = {},
): OptionEdit[] {
  return parts.flatMap(({ scope, options }) =>
    changedOptions(options, (o) =>
      displayedValue(pending, scriptTags, scope, o.key),
    ).map((o) => ({
      tagKey: scriptTagKey(scope, o.key),
      spadsName: o.key,
      value: o.default ?? "",
    })),
  );
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
