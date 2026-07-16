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

/** Whether the user has overridden an option away from its default. */
export const isChanged = (o: ConfigOption, value?: string) =>
  o.type !== "section" && value !== undefined && value !== (o.default ?? "");

/**
 * The `[modoptions]` block to write: every option's effective value, defaults
 * included. Sending only user-changed options is wrong — the engine does not
 * fall back to the game's declared defaults for absent keys, it applies its own
 * (`MaxUnits` 32000, `GhostedBuildings` 1, `FixedAllies` 1, ...), and game Lua
 * sees `Spring.GetModOptions()` verbatim. Sections carry no value and are
 * skipped, as is any option with neither a value nor a default.
 */
export function effectiveOptions(
  options: ConfigOption[],
  values: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of options) {
    if (o.type === "section") continue;
    const v = effectiveValue(o, values[o.key]);
    if (v !== undefined) out[o.key] = v;
  }
  return out;
}
