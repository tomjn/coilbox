/**
 * What to call a unit on the workshop page.
 *
 * The internal key is not a name. `armaak` is what every part of coilbox joins
 * on and what the def table is keyed by, and it is the wrong thing to put in
 * front of a person on its own.
 *
 * The readable name does not come from the unit definition, and cannot be made
 * to. Measured against the two games installed here on 7 September 2026:
 *
 *   - Balanced Annihilation V15.9.8 writes `name = "Commander"` in the def, and
 *     unitsync's own `GetFullUnitName` answers for 374 of its 379 units.
 *   - Beyond All Reason test-30922-8064a43 writes no `name`, no `humanName` and
 *     no `description` in any def, and `GetFullUnitName` answers for 0 of its
 *     564 units. Its names live in the archive's `language/en/units.json`.
 *
 * So the name has a per-game source, and the one read that covers both is the
 * curated unit dataset: the worker falls back to that language file for exactly
 * the games unitsync cannot answer for (issue #1925), which brings BAR to 511
 * of 564. `unitChoices.ts` already owns the "what is this unit called" question
 * for every other picker in the app, so its answer is taken rather than
 * repeated, and this only adds what it has no way to see: the def in front of
 * us, and the key to fall back on.
 *
 * The def is still consulted, because the engine does read `humanName` and
 * `name` and some games do write them. It is read case insensitively for the
 * reason the field registry is: `gamedata/defs.lua` lowercases every key, so a
 * `def.humanName` property access can never hit. The order is the engine's own,
 * from `rts/Sim/Units/UnitDef.cpp:290`, where `humanName` is read with `name`
 * as its default and the engine's comment beside it calls `name` the internal
 * name.
 */
import type { UnitDatasetEntry } from "@/content/bindings";
import { unitLabel } from "@/content/unitChoices";

/** The key a def spells `wanted` with, or `undefined` if it declares none. */
function spelling(
  def: Record<string, unknown>,
  wanted: string,
): string | undefined {
  const lower = wanted.toLowerCase();
  return Object.keys(def).find((k) => k.toLowerCase() === lower);
}

/** Read a def key however the game happened to spell it. */
function readInsensitive(def: Record<string, unknown>, key: string): unknown {
  const spelt = spelling(def, key);
  return spelt === undefined ? undefined : def[spelt];
}

/**
 * The name to show, and the key to fall back on.
 *
 * `entry` is the unit's row in the curated dataset, absent while that read is
 * still open or for a unit it does not carry. A game that names a unit nowhere
 * gets its internal key, which reads badly and is at least true: inventing a
 * prettier version of `armaak` would be inventing a fact about the game.
 */
export function unitDisplayName(
  key: string,
  def: Record<string, unknown> | undefined,
  entry?: UnitDatasetEntry,
): string {
  if (entry) {
    const named = unitLabel(entry).trim();
    // `unitLabel` falls back to the entry's own internal name, which is this
    // key, so a dataset that could not name the unit is not treated as if it
    // had.
    if (named && named !== key) return named;
  }
  for (const candidate of ["humanName", "name"]) {
    const value = readInsensitive(def ?? {}, candidate);
    if (typeof value === "string" && value.trim() && value.trim() !== key)
      return value.trim();
  }
  return key;
}

/**
 * Which def key a rename writes to, in the game's own spelling of it.
 *
 * The write side of the read above, and the same order for the same reason.
 * `humanName` when the def declares one, since that is what the engine reads
 * first. Otherwise `name`, but only when the def's `name` is a name rather than
 * a repeat of the internal key, because overwriting the internal name would
 * rename the unit itself. A def carrying neither gets a `humanName`, which is
 * the key the engine looks in first and the one `clones.ts` adds for the same
 * reason.
 */
export function defNamePath(
  key: string,
  def: Record<string, unknown> | undefined,
): string {
  const table = def ?? {};
  const human = spelling(table, "humanName");
  if (human) return human;
  const plain = spelling(table, "name");
  if (plain) {
    const value = table[plain];
    if (typeof value !== "string" || value.trim() !== key) return plain;
  }
  return "humanName";
}

/** Which def key a rewritten tooltip writes to, in the game's own spelling. */
export function defDescriptionPath(
  def: Record<string, unknown> | undefined,
): string {
  return spelling(def ?? {}, "description") ?? "description";
}
