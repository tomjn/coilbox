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
 * Every language the game ships, not just English (issue #2672). Beyond All
 * Reason carries a `units.json` under `language/de`, `en`, `es`, `fr`, `ru` and
 * `zh`, and a rename made against English alone leaves the other five saying the
 * old thing. So the store has a language dimension and the panel has a picker,
 * for a game that ships more than one. A game with a single locale gets neither.
 *
 * A translation is sparse against English rather than a full copy of it: BAR's
 * own `modules/i18n/i18n.lua` loads English at startup and hands back the
 * English string for a key the chosen locale has no entry for. So a locale's box
 * shows the English value greyed where that locale says nothing, which is what
 * the player would read, and typing that value back in is not an edit.
 */
import { readPath, type UnitOverrides } from "./overrides";
import { defDescriptionPath, defNamePath, unitDisplayName } from "./unitName";

/** The two things on a unit that are words rather than numbers. */
export type TextField = "name" | "description";

/** Where a game keeps the words a player reads. */
export type TextHome = "def" | "language";

/**
 * The locale everything else falls back to.
 *
 * The game's, not a preference: BAR's i18n module loads English up front and
 * answers in English for a key the player's own locale is missing. It is also
 * the only locale a project saved before #2672 could have been edited in, since
 * the worker read that file and no other.
 */
export const BASE_LANGUAGE = "en";

/** The file one language's edits belong in, as `dataset.rs` reads it. */
export const languageUnitsFile = (code: string) =>
  `language/${code}/units.json`;

/** What one of a game's `units.json` files says, as the worker hands it over. */
export interface LanguageText {
  names?: Record<string, string>;
  descriptions?: Record<string, string>;
}

/** Every translation a game ships, keyed by its language code. */
export type LanguageTexts = Record<string, LanguageText>;

/**
 * The languages on offer, English first and the rest in code order.
 *
 * English leads because it is what the others fall back to, so it is the one
 * worth filling in first and the one a missing translation shows.
 */
export function languageCodes(texts: LanguageTexts | undefined): string[] {
  const codes = Object.keys(texts ?? {}).sort();
  return codes.includes(BASE_LANGUAGE)
    ? [BASE_LANGUAGE, ...codes.filter((c) => c !== BASE_LANGUAGE)]
    : codes;
}

/**
 * The language a missing translation reads in, and the one an edit lands in
 * when nothing has said which.
 *
 * English where the game ships it. A game that ships only Russian falls back to
 * Russian, since falling back to a file that does not exist would leave every
 * box blank.
 */
export function baseLanguage(texts: LanguageTexts | undefined): string {
  return languageCodes(texts)[0] ?? BASE_LANGUAGE;
}

/**
 * Name and description edits for a game that keeps them outside its unit table,
 * by unit, then by language, then by field.
 *
 * Sparse at all three levels, the same way {@link UnitOverrides} is at its two:
 * a language a unit has no edit in does not linger as an empty object, and a
 * unit with no language left drops out.
 */
export type UnitTextEdits = Record<
  string,
  Record<string, Partial<Record<TextField, string>>>
>;

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
  texts: LanguageTexts | undefined,
): TextHome {
  const named = texts?.[baseLanguage(texts)]?.names ?? {};
  if (Object.keys(named).length === 0) return "def";
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
  /**
   * The language `inherited` was read from, when this language says nothing and
   * the value shown is the one it falls back to. Absent otherwise.
   */
  inheritedFrom?: string;
  /**
   * The unit whose entries this one reads, for a def that redirects its lookup
   * with `customParams.i18nfromunit`. Absent for the ordinary case.
   *
   * A redirected unit's own `units.names.<key>` is a key the game never asks
   * for, so there is nothing here to edit and the row is read only.
   */
  redirect?: string;
}

/** How a value reads once it is on screen. */
const asText = (value: unknown): string =>
  value === undefined || value === null ? "" : String(value);

/**
 * The unit a def hands its name and description lookup to, if it hands them off.
 *
 * Beyond All Reason's `luaui/i18nhelpers.lua` reads
 * `units.names.<customParams.i18nfromunit>` in place of the unit's own key,
 * which is how its commander variants and its scavengers borrow the name of the
 * unit they are made from. Eleven of BAR's unit files set it, measured on
 * 8 September 2026 against test-30922-8064a43.
 *
 * Def keys arrive lowercased, hence the spelling.
 */
export function textRedirect(
  def: Record<string, unknown> | undefined,
): string | undefined {
  const params = def?.customparams;
  if (typeof params !== "object" || params === null) return undefined;
  const from = (params as Record<string, unknown>).i18nfromunit;
  if (typeof from !== "string") return undefined;
  const key = from.trim().toLowerCase();
  return key === "" ? undefined : key;
}

/**
 * Both fields for one unit, ready to draw.
 *
 * `def` is the unit's table as the game left it, `texts` is what each of the
 * game's localisation files says, and neither is written to here. `language` is
 * the locale on screen, which for a game shipping one is the only one there is.
 */
export function unitTextRows({
  unitKey,
  def,
  home,
  texts,
  language,
  overrides,
  edits,
}: {
  unitKey: string;
  def: Record<string, unknown> | undefined;
  home: TextHome;
  texts: LanguageTexts | undefined;
  language?: string;
  overrides: UnitOverrides;
  edits: UnitTextEdits;
}): Record<TextField, UnitTextRow> {
  const base = baseLanguage(texts);
  const lang = language ?? base;
  const redirect = textRedirect(def);
  const lookup = redirect ?? unitKey;
  const shipped = (code: string, field: TextField): string | undefined =>
    (field === "name" ? texts?.[code]?.names : texts?.[code]?.descriptions)?.[
      lookup
    ];

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
    // What this locale itself says, else what the player would read instead:
    // the base language, as the project has left it. BAR's i18n module answers
    // in English for a key the chosen locale is missing, so that fallback is
    // the game's behaviour rather than a convenience here.
    const own = shipped(lang, field);
    const fallback =
      lang === base
        ? undefined
        : (edits[lookup]?.[base]?.[field] ?? shipped(base, field));
    const inheritedValue = own ?? fallback;
    const edit =
      redirect === undefined ? edits[unitKey]?.[lang]?.[field] : undefined;
    return {
      field,
      value: edit ?? asText(inheritedValue),
      inherited: asText(inheritedValue),
      inheritedValue,
      present: inheritedValue !== undefined,
      state: edit === undefined ? "inherited" : "overridden",
      ...(own === undefined && fallback !== undefined
        ? { inheritedFrom: base }
        : {}),
      ...(redirect === undefined ? {} : { redirect }),
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
 *
 * One name out of however many languages the project holds, because the caller
 * has one row to draw it in. English wins where there is an English edit, since
 * that is the one every other locale falls back to, and a project edited only in
 * German shows the German rather than nothing.
 */
export function nameEdit(
  unitKey: string,
  def: Record<string, unknown> | undefined,
  overrides: UnitOverrides,
  edits: UnitTextEdits,
): string | undefined {
  const entry = edits[unitKey] ?? {};
  const own = entry[BASE_LANGUAGE]?.name ?? firstNamed(entry);
  if (own !== undefined) return own;
  const patch = overrides[unitKey];
  if (!patch) return undefined;
  const value = patch[defNamePath(unitKey, def)];
  return typeof value === "string" ? value : undefined;
}

/** A name in whichever language the project happens to hold one in. */
function firstNamed(
  entry: Record<string, Partial<Record<TextField, string>>>,
): string | undefined {
  for (const code of Object.keys(entry).sort()) {
    const name = entry[code]?.name;
    if (name !== undefined) return name;
  }
  return undefined;
}

/**
 * Record one edit against a language home, in one language.
 *
 * `setOverride`'s rule, for the same reason: writing back what was already
 * inherited removes the key rather than storing it, so typing the game's own
 * name into the box leaves the unit as it was found. In a locale that says
 * nothing of its own that inherited value is the English one, so retyping what
 * the box already shows does not manufacture a translation.
 */
export function setUnitText(
  edits: UnitTextEdits,
  unitKey: string,
  language: string,
  field: TextField,
  value: string,
  inherited: string,
): UnitTextEdits {
  if (value === inherited)
    return clearUnitText(edits, unitKey, language, field);
  const entry = edits[unitKey] ?? {};
  return {
    ...edits,
    [unitKey]: { ...entry, [language]: { ...entry[language], [field]: value } },
  };
}

/**
 * Put one field back to what the game says, by forgetting the edit.
 *
 * Prunes upwards: the language goes when its last field does, and the unit goes
 * when its last language does, so an emptied store is `{}` rather than a tree of
 * empty objects.
 */
export function clearUnitText(
  edits: UnitTextEdits,
  unitKey: string,
  language: string,
  field: TextField,
): UnitTextEdits {
  const unit = edits[unitKey];
  const fields = unit?.[language];
  if (!unit || !fields || !Object.hasOwn(fields, field)) return edits;
  const { [field]: _dropped, ...keptFields } = fields;
  const { [language]: _lang, ...keptLanguages } = unit;
  const { [unitKey]: _unit, ...others } = edits;
  if (Object.keys(keptFields).length > 0)
    return {
      ...others,
      [unitKey]: { ...keptLanguages, [language]: keptFields },
    };
  return Object.keys(keptLanguages).length === 0
    ? others
    : { ...others, [unitKey]: keptLanguages };
}

/** Forget every edit on one unit, in every language. */
export function clearUnitTexts(
  edits: UnitTextEdits,
  unitKey: string,
): UnitTextEdits {
  if (!Object.hasOwn(edits, unitKey)) return edits;
  const { [unitKey]: _dropped, ...rest } = edits;
  return rest;
}

/**
 * How many of these one unit carries.
 *
 * A German name and an English name are two edits, not one. The number is a
 * change count on the unit list beside the field overrides, and translating a
 * rename is work the project is holding for you either way.
 */
export function unitTextCount(edits: UnitTextEdits, unitKey: string): number {
  return countFields(edits[unitKey]);
}

/** How many the project carries in total. */
export function textEditCount(edits: UnitTextEdits): number {
  return Object.values(edits).reduce((n, unit) => n + countFields(unit), 0);
}

/** Fields set across every language of one unit. */
function countFields(
  entry: Record<string, Partial<Record<TextField, string>>> | undefined,
): number {
  return Object.values(entry ?? {}).reduce(
    (n, fields) => n + Object.keys(fields).length,
    0,
  );
}
