/**
 * A unit's name and its one-line description, which are not fields like the
 * others (issue #2650).
 *
 * Renaming a unit and rewriting its tooltip are the first edits a non-technical
 * modder makes, and they are the two edits whose destination depends on the
 * game. Measured against the two games installed here on 7 September 2026:
 *
 *   - Balanced Annihilation V15.9.8 writes `name = "Arm Juno"` and
 *     `description = "Anti Radar/Jammer/Minefield/ScoutSpam Weapon"` in the
 *     unitdef. Renaming it is an ordinary override against those keys, so it is
 *     stored as one and the whole of `overrides.ts` applies to it unchanged.
 *   - Beyond All Reason test-30922-8064a43 writes no `name`, no `humanName` and
 *     no `description` in any of its 564 unitdefs. Both live in the archive's
 *     `language/en/units.json`, under `units.names` and `units.descriptions`,
 *     and its own `luaui/i18nhelpers.lua` builds every unit's displayed name
 *     from `Spring.I18N('units.names.' .. unitDefName)` with no fall back to
 *     the def at all. A `name` override against a BAR unit is therefore not a
 *     weaker edit, it is a key the game never reads.
 *
 * So the edit has two homes, {@link TextHome}, and which one a game uses is a
 * fact about the game rather than a preference. {@link textHome} answers it
 * from what the game actually did, not from its name.
 *
 * A def home writes through `overrides.ts` and gets its sparseness, its reset
 * and its change count for free. A language home needs a store of its own,
 * {@link UnitTextEdits}, because the artefact being patched is a JSON file
 * rather than a unit table, and the same rules are kept by hand: a key only
 * exists once the user has said something, writing the inherited value back
 * removes it, and a unit with nothing left drops out.
 *
 * Only English. BAR ships a `units.json` for six locales and the worker reads
 * one, so this offers one. Offering the rest is issue #2672.
 */
import { readPath, type UnitOverrides } from "./overrides";
import { defDescriptionPath, defNamePath, unitDisplayName } from "./unitName";

/** The two things on a unit that are words rather than numbers. */
export type TextField = "name" | "description";

/** Where a game keeps the words a player reads. */
export type TextHome = "def" | "language";

/** The file a language home writes to, as `dataset.rs` reads it. */
export const LANGUAGE_UNITS_FILE = "language/en/units.json";

/** What a game's `language/en/units.json` says, as the worker hands it over. */
export interface LanguageText {
  names?: Record<string, string>;
  descriptions?: Record<string, string>;
}

/**
 * Name and description edits for a game that keeps them outside its unit table.
 * Sparse at both levels, the same way {@link UnitOverrides} is.
 */
export type UnitTextEdits = Record<string, Partial<Record<TextField, string>>>;

/**
 * Where this game's names and descriptions live.
 *
 * Answered from the game's own units, because that is the only thing that can
 * answer it. A game whose unitdefs name anything at all is a game whose
 * unitdefs are where a rename belongs, even where it also ships a localisation
 * file for the few units its defs leave blank.
 *
 * Pass the game's own unit table, never the table with the project's copies
 * merged in. A copy made in a language home carries no readable name of its own
 * any more (issue #2673), but one made before that rule does, as does any copy
 * in a def home and any unit the lego builder exported, and one of those in
 * Beyond All Reason would otherwise flip the whole game over to a home its 564
 * units do not use. The answer is a fact about the game either way, so it is
 * asked of the game.
 */
export function textHome(
  units: Record<string, Record<string, unknown>>,
  language: LanguageText | undefined,
): TextHome {
  if (Object.keys(language?.names ?? {}).length === 0) return "def";
  for (const [key, def] of Object.entries(units))
    if (unitDisplayName(key, def, undefined) !== key) return "def";
  return "language";
}

/** One of the two fields, in whichever state the project has left it. */
export interface UnitTextRow {
  field: TextField;
  /** The value on screen: the user's if they set one, else `inherited`. */
  value: string;
  /** What it reads with no edit, empty when nothing says. */
  inherited: string;
  /** The same value untouched, which is what an override is measured against. */
  inheritedValue: unknown;
  /** Whether anything under the edit declares this at all. */
  present: boolean;
  state: "inherited" | "overridden";
  /** The def key the edit is written to, for a def home only. */
  path?: string;
}

/** How a value reads once it is on screen. */
const asText = (value: unknown): string =>
  value === undefined || value === null ? "" : String(value);

/**
 * Both fields for one unit, ready to draw.
 *
 * `def` is the unit's table as the game left it, `language` is what the game's
 * localisation file says, and neither is written to here.
 */
export function unitTextRows({
  unitKey,
  def,
  home,
  language,
  overrides,
  edits,
}: {
  unitKey: string;
  def: Record<string, unknown> | undefined;
  home: TextHome;
  language: LanguageText | undefined;
  overrides: UnitOverrides;
  edits: UnitTextEdits;
}): Record<TextField, UnitTextRow> {
  const row = (field: TextField): UnitTextRow => {
    if (home === "def") {
      const path =
        field === "name" ? defNamePath(unitKey, def) : defDescriptionPath(def);
      const inheritedValue = readPath(def, path);
      const patch = overrides[unitKey];
      const overridden = patch !== undefined && Object.hasOwn(patch, path);
      return {
        field,
        value: overridden ? asText(patch?.[path]) : asText(inheritedValue),
        inherited: asText(inheritedValue),
        inheritedValue,
        present: inheritedValue !== undefined && inheritedValue !== null,
        state: overridden ? "overridden" : "inherited",
        path,
      };
    }
    const table = field === "name" ? language?.names : language?.descriptions;
    const inheritedValue = table?.[unitKey];
    const edit = edits[unitKey]?.[field];
    return {
      field,
      value: edit ?? asText(inheritedValue),
      inherited: asText(inheritedValue),
      inheritedValue,
      present: inheritedValue !== undefined,
      state: edit === undefined ? "inherited" : "overridden",
    };
  };
  return { name: row("name"), description: row("description") };
}

/**
 * The name the user gave a unit, if they gave it one.
 *
 * Both stores are read rather than the one this game's home points at, because
 * the answer is the same either way and the caller is a unit list that would
 * otherwise have to decide per row whether the unit is one the game shipped or
 * one the project copied. Only the panel writes to these, and it writes to one.
 */
export function nameEdit(
  unitKey: string,
  def: Record<string, unknown> | undefined,
  overrides: UnitOverrides,
  edits: UnitTextEdits,
): string | undefined {
  const own = edits[unitKey]?.name;
  if (own !== undefined) return own;
  const patch = overrides[unitKey];
  if (!patch) return undefined;
  const value = patch[defNamePath(unitKey, def)];
  return typeof value === "string" ? value : undefined;
}

/**
 * Record one edit against a language home.
 *
 * `setOverride`'s rule, for the same reason: writing back what was already
 * inherited removes the key rather than storing it, so typing the game's own
 * name into the box leaves the unit as it was found.
 */
export function setUnitText(
  edits: UnitTextEdits,
  unitKey: string,
  field: TextField,
  value: string,
  inherited: string,
): UnitTextEdits {
  if (value === inherited) return clearUnitText(edits, unitKey, field);
  return { ...edits, [unitKey]: { ...edits[unitKey], [field]: value } };
}

/** Put one field back to what the game says, by forgetting the edit. */
export function clearUnitText(
  edits: UnitTextEdits,
  unitKey: string,
  field: TextField,
): UnitTextEdits {
  const unit = edits[unitKey];
  if (!unit || !Object.hasOwn(unit, field)) return edits;
  const { [field]: _dropped, ...rest } = unit;
  const { [unitKey]: _unit, ...others } = edits;
  return Object.keys(rest).length === 0
    ? others
    : { ...others, [unitKey]: rest };
}

/** Forget both edits on one unit. */
export function clearUnitTexts(
  edits: UnitTextEdits,
  unitKey: string,
): UnitTextEdits {
  if (!Object.hasOwn(edits, unitKey)) return edits;
  const { [unitKey]: _dropped, ...rest } = edits;
  return rest;
}

/** How many of these one unit carries. */
export function unitTextCount(edits: UnitTextEdits, unitKey: string): number {
  return Object.keys(edits[unitKey] ?? {}).length;
}

/** How many the project carries in total. */
export function textEditCount(edits: UnitTextEdits): number {
  return Object.values(edits).reduce(
    (n, unit) => n + Object.keys(unit).length,
    0,
  );
}
