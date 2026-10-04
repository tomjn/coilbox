import type { ConfigOption } from "@/content/bindings";

/**
 * Mod/map option grouping and value derivation, kept pure and hook-free so the
 * launcher pages and their tests can share it.
 *
 * unitsync hands us one flat list in declaration order, where a section is itself
 * an option (`type: "section"`) that other options point at via `section`. So
 * grouping is our job, and a section must never be treated as a setting.
 */

/** A section and the options declared under it; `name` is absent for top-level options. */
export interface OptionGroup {
  /** The section's option key; `""` for the top-level group. */
  key: string;
  name?: string;
  description?: string;
  options: ConfigOption[];
}

/**
 * Group a flat option list by section, preserving declaration order. Top-level
 * options (and any naming a section the game never declared, which would
 * otherwise vanish from the UI) collect into a leading unnamed group. Sections
 * with no options are dropped rather than rendered empty.
 */
export function groupOptions(options: ConfigOption[]): OptionGroup[] {
  const sections = options.filter((o) => o.type === "section");
  const byKey = new Map(sections.map((s) => [s.key, s] as const));

  const groups = new Map<string, OptionGroup>();
  const groupFor = (key: string): OptionGroup => {
    const existing = groups.get(key);
    if (existing) return existing;
    const s = byKey.get(key);
    const group: OptionGroup = {
      key,
      name: s?.name,
      description: s?.description,
      options: [],
    };
    groups.set(key, group);
    return group;
  };

  // Seed the top-level group first so it always leads, then let sections take
  // their declaration order from the options that land in them.
  const top = groupFor("");

  for (const o of options) {
    if (o.type === "section") continue;
    const key = o.section && byKey.has(o.section) ? o.section : "";
    groupFor(key).options.push(o);
  }

  if (top.options.length === 0) groups.delete("");
  return [...groups.values()].filter((g) => g.options.length > 0);
}

/** The value in effect for an option: the user's override, else its default. */
export const effectiveValue = (
  o: ConfigOption,
  value?: string,
): string | undefined => value ?? o.default;

/**
 * Apply one edit to a setup's option values. A value of `undefined` removes the
 * key rather than writing a blank, because these maps are deliberately sparse:
 * an option nobody changed is absent, so a saved preset follows the game when
 * the game changes its default, and the launch paths fill the gaps themselves
 * (see `effectiveOptions`).
 */
export function withOption(
  values: Record<string, string>,
  key: string,
  value: string | undefined,
): Record<string, string> {
  if (value !== undefined) return { ...values, [key]: value };
  const { [key]: _dropped, ...rest } = values;
  return rest;
}

/** A bool as the engine and lobby servers spell it, or undefined for anything else. */
function parseBool(v: string): boolean | undefined {
  const t = v.trim().toLowerCase();
  if (t === "1" || t === "true") return true;
  if (t === "0" || t === "false" || t === "") return false;
  return undefined;
}

/** A number as written, or undefined for an empty or non-numeric string. */
function parseNumber(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Whether two spellings of an option's value are the same value, by the
 * option's declared type. A lobby server sends everything as a string, and
 * "1.0" is the default of a "1" number and "true" the default of a "1" bool.
 * Anything that does not parse as its type falls back to exact comparison.
 */
function sameOptionValue(o: ConfigOption, a: string, b: string): boolean {
  if (o.type === "bool") {
    const pa = parseBool(a);
    const pb = parseBool(b);
    if (pa !== undefined && pb !== undefined) return pa === pb;
  }
  if (o.type === "number") {
    const pa = parseNumber(a);
    const pb = parseNumber(b);
    if (pa !== undefined && pb !== undefined) return pa === pb;
  }
  return a === b;
}

/**
 * Whether an option's value differs from the default its game or map declares.
 * This is the one answer to "was this changed", for the marks on the option
 * panels, their counts, and `sparseOptions`.
 *
 * `undefined` means nobody set a value, which is the default. An option with no
 * declared default is taken to default to the empty value, which is what its
 * control shows and what `effectiveOptions` leaves out, so any other value is a
 * change. A section is never changed.
 */
export const isChanged = (o: ConfigOption, value?: string) =>
  o.type !== "section" &&
  value !== undefined &&
  !sameOptionValue(o, value, o.default ?? "");

/**
 * The options among `options` whose value, as `readValue` reports it, differs
 * from their default. The set a "reset" has to change, and the number it shows.
 */
export const changedOptions = (
  options: ConfigOption[],
  readValue: (o: ConfigOption) => string | undefined,
): ConfigOption[] => options.filter((o) => isChanged(o, readValue(o)));

/**
 * `values` with the override of every changed option in `options` dropped.
 *
 * Dropping the key is how a sparse setup says "at default" (see `withOption`),
 * so a reset leaves the option following the game if the game changes its mind,
 * and `effectiveOptions` fills the declared default in at launch. An option with
 * no declared default goes back to empty the same way. Keys outside `options`
 * are untouched.
 */
export function resetOptionValues(
  options: ConfigOption[],
  values: Record<string, string>,
): Record<string, string> {
  return changedOptions(options, (o) => values[o.key]).reduce(
    (next, o) => withOption(next, o.key, undefined),
    values,
  );
}

/**
 * An option's declared default as a reader would say it: On or Off for a bool,
 * the item's name for a list, "empty" for an empty one, otherwise as written.
 */
export function defaultLabel(o: ConfigOption): string {
  const d = o.default ?? "";
  if (o.type === "bool") return parseBool(d) ? "On" : "Off";
  if (o.type === "list")
    return o.listItems?.find((it) => it.key === d)?.name ?? (d || "empty");
  return d === "" ? "empty" : d;
}

/**
 * The `[modoptions]` block to write: the caller's values, with the game's
 * declared default added for every option they left unset.
 *
 * Sending only the options a player changed is wrong. The engine does not fall
 * back to the game's declared defaults for absent keys. `CGameSetup::Init`
 * reads its own built-in ones (`MaxUnits` 32000, `GhostedBuildings` 1,
 * `FixedAllies` 1, `MaxSpeed` 20, ...) and hands game Lua whatever the script
 * literally said, so `Spring.GetModOptions()` has a hole where the game's
 * default should be. Everything that launches a game fills first, which is why
 * this is called from `toBattleConfig` rather than from any one screen.
 *
 * Sections carry no value and are skipped, as is any option with neither a
 * value nor a default. A value whose key the schema does not declare is kept:
 * a scenario adds `coilbox_mission`, which the game never declares and the
 * runtime cannot find the mission without.
 */
export function effectiveOptions(
  options: ConfigOption[],
  values: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...values };
  for (const o of options) {
    if (o.type === "section") continue;
    const v = effectiveValue(o, values[o.key]);
    if (v !== undefined) out[o.key] = v;
  }
  return out;
}

/**
 * The inverse of {@link effectiveOptions}: drop every value that is only the
 * game's own default, leaving what was actually chosen.
 *
 * For turning a full `[modoptions]` block back into something worth saving. A
 * replay records every option its match ran with and says nothing about who
 * chose what, so a preset made from one pinned 36 of SplinterFaction's 38
 * defaults as if a player had picked them (#1838). Sparse is what a preset, a
 * shared scenario and a campaign snapshot all store, and it is what lets a saved
 * setup follow the game when the game changes its mind.
 *
 * A value whose key `options` does not declare is kept, for the same reason
 * `effectiveOptions` keeps it: coilbox cannot tell a stale option from
 * `coilbox_mission`, which the game never declares and the scenario runtime
 * cannot find its mission without. An empty `options` list means "not known
 * yet", so nothing is dropped. The round trip through `effectiveOptions` is
 * exact either way, which is why sparsifying costs a refight nothing.
 */
export function sparseOptions(
  options: ConfigOption[],
  values: Record<string, string>,
): Record<string, string> {
  const declared = new Map(
    options.filter((o) => o.type !== "section").map((o) => [o.key, o] as const),
  );
  return Object.fromEntries(
    Object.entries(values).filter(([key, value]) => {
      const o = declared.get(key);
      return o ? isChanged(o, value) : true;
    }),
  );
}
