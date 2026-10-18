import catalogueFile from "@/data/engineLuaCompat.json";
import type { LuaCompatResult } from "./bindings";

/**
 * What would stop an old game running on the current engine, worked out from
 * reads the page has already made (issue #4554). Pure, so every finding kind is
 * tested from fixed inputs. The map page's report in `mapCompatReport.ts`
 * (issue #4565) shares {@link Finding} and the row component that draws it.
 */

/** `problem` is something the engine no longer does. `info` is worth knowing
 *  and changes nothing. */
export type FindingSeverity = "problem" | "info";

/** A heading with lines under it, such as one file and the hits in it. */
export interface FindingDetail {
  heading: string;
  lines: string[];
}

export interface Finding {
  /** Stable per kind, such as `models-3do`. */
  kind: string;
  label: string;
  severity: FindingSeverity;
  /** How many of the thing there are, when counting them means anything. */
  count?: number;
  /** Shown when the row is expanded. A row without them does not expand. */
  details?: FindingDetail[];
}

/** One entry of `src/data/engineLuaCompat.json`. */
export interface CompatEntry {
  id: string;
  kind: "removed" | "renamed" | "signature" | "defTag" | "file";
  name: string;
  since?: string;
  replacement?: string;
  note?: string;
}

const CATALOGUE = catalogueFile.entries as CompatEntry[];

/** The unit and weapon tables `unitsync_unit_defs` returns. */
export interface CompatDefs {
  units: Record<string, Record<string, unknown>>;
  weaponDefs: Record<string, Record<string, unknown>>;
}

export interface CompatReportInputs {
  /** Every member path in the game's primary archive. */
  files: string[];
  /** The Lua scan, or null while it has not answered. */
  lua?: LuaCompatResult | null;
  /** The game's unit defs, or null while they have not answered. */
  defs?: CompatDefs | null;
  /** Reads that failed, in their own words. */
  errors?: string[];
  /** Defaults to the catalogue the app ships. */
  catalogue?: CompatEntry[];
}

const lower = (p: string) => p.toLowerCase();

/** The findings for one game, in a fixed order. Empty when nothing is wrong. */
export function buildReport(inputs: CompatReportInputs): Finding[] {
  const catalogue = inputs.catalogue ?? CATALOGUE;
  const files = inputs.files.map(lower);
  const has = (path: string) => files.includes(path);
  const out: Finding[] = [];

  const models = files.filter((f) => /^objects3d\/.+\.3do$/.test(f)).length;
  if (models > 0)
    out.push({
      kind: "models-3do",
      label: ".3do models",
      severity: "problem",
      count: models,
    });

  const defs = files.filter((f) => /^units\/.+\.(fbi|tdf)$/.test(f)).length;
  if (defs > 0)
    out.push({
      kind: "defs-fbi",
      label: ".fbi or .tdf unit definitions",
      severity: "problem",
      count: defs,
    });

  if (inputs.lua) {
    const lua = luaFinding(inputs.lua, catalogue);
    if (lua) out.push(lua);
  }

  if (inputs.defs) {
    const tags = defTagFinding(inputs.defs, catalogue);
    if (tags) out.push(tags);
  }

  const hasLuaui = files.some((f) => f.startsWith("luaui/"));
  const hasWidgets = files.some((f) => f.startsWith("luaui/widgets/"));
  if (!hasWidgets)
    out.push({
      kind: "no-widgets",
      label: hasLuaui ? "No luaui/widgets folder" : "No luaui folder",
      severity: "problem",
    });

  if (has("modinfo.tdf") && !has("modinfo.lua"))
    out.push({
      kind: "modinfo-tdf",
      label: "modinfo.tdf instead of modinfo.lua",
      severity: "problem",
    });

  if (has("gamedata/messages.tdf"))
    out.push({
      kind: "messages-tdf",
      label: "gamedata/messages.tdf",
      severity: "problem",
    });

  if (out.some((f) => f.severity === "problem")) {
    const gadgets = gadgetFinding(has, inputs.defs ?? null);
    if (gadgets) out.push(gadgets);
  }

  const unresolved = inputs.lua?.unresolved ?? [];
  if (unresolved.length > 0)
    out.push({
      kind: "lua-unresolved",
      label: "Dependencies not scanned for Lua",
      severity: "info",
      count: unresolved.length,
      details: [{ heading: "Not installed", lines: unresolved }],
    });

  const errors = readErrorsFinding([
    ...(inputs.errors ?? []),
    ...(inputs.lua?.errors ?? []),
  ]);
  if (errors) out.push(errors);

  return out;
}

/** A def flag as the def files write it: `true`, a number other than 0, or
 *  a string other than `0`, `false` or nothing. */
function flag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string")
    return !["", "0", "false"].includes(value.trim().toLowerCase());
  return false;
}

/** Every weapon definition, top level and declared inside a unit. */
function allWeapons(
  defs: CompatDefs,
): Array<[string, Record<string, unknown>]> {
  const weapons: Array<[string, Record<string, unknown>]> = [
    ...Object.entries(defs.weaponDefs),
  ];
  for (const [unit, def] of Object.entries(defs.units)) {
    const own = lookup(def, ["weapondefs"]);
    if (own && typeof own === "object" && !Array.isArray(own))
      for (const [name, w] of Object.entries(own))
        if (w && typeof w === "object")
          weapons.push([`${unit}.${name}`, w as Record<string, unknown>]);
  }
  return weapons;
}

/**
 * The compat gadgets (issue #4559) a build would turn on, and what each found.
 * A gadget decides for itself when the game loads, from the game's files, so
 * this repeats its check from what the page has read. The aircraft gadget also
 * leaves out a plane whose unit script sets CRASHING, and turns off for a game
 * whose LuaRules calls `Spring.SetUnitCrashing`. Neither is read here, so its
 * list can name planes it leaves alone.
 */
function gadgetFinding(
  has: (path: string) => boolean,
  defs: CompatDefs | null,
): Finding | null {
  const details: FindingDetail[] = [];
  if (defs) {
    // A strafing air unit: it flies, and is not a builder, a transport or a
    // gunship (`IsStrafingAirUnit` in the engine's rts/Sim/Units/UnitDef.h).
    const planes = Object.entries(defs.units)
      .filter(
        ([, d]) =>
          flag(lookup(d, ["canfly"])) &&
          !flag(lookup(d, ["builder"])) &&
          !flag(lookup(d, ["hoverattack"])) &&
          !flag(lookup(d, ["transportcapacity"])),
      )
      .map(([name]) => name)
      .sort();
    if (planes.length > 0)
      details.push({ heading: "coilbox_compat_aircraft_crash", lines: planes });

    // A weapon that is not a turret and not a starburst launcher fires only
    // forward (rts/Sim/Weapons/WeaponDef.cpp).
    const forward = allWeapons(defs)
      .filter(([, w]) => {
        const type = String(lookup(w, ["weapontype"]) ?? "").toLowerCase();
        return (
          !flag(lookup(w, ["turret"])) &&
          !flag(lookup(w, ["vlaunch"])) &&
          type !== "starburstlauncher"
        );
      })
      .map(([name]) => name)
      .sort();
    if (forward.length > 0)
      details.push({
        heading: "coilbox_compat_only_forward_aim",
        lines: forward,
      });
  }
  if (has("gamedata/messages.tdf"))
    details.push({
      heading: "coilbox_compat_messages_tdf",
      lines: ["gamedata/messages.tdf"],
    });
  if (details.length === 0) return null;
  return {
    kind: "compat-gadgets",
    label: "Compatibility gadgets a build turns on",
    severity: "info",
    count: details.length,
    details,
  };
}

/** The row for reads that failed, or null when none did. Shared with the map
 *  report. */
export function readErrorsFinding(errors: string[]): Finding | null {
  if (errors.length === 0) return null;
  return {
    kind: "read-errors",
    label: "Could not check everything",
    severity: "info",
    count: errors.length,
    details: [{ heading: "Errors", lines: errors }],
  };
}

/** What changed about one entry, in a few words. */
function changeOf(entry: CompatEntry | undefined): string {
  if (!entry) return "changed";
  const since = entry.since ? ` in ${entry.since}` : "";
  switch (entry.kind) {
    case "renamed":
      return entry.replacement
        ? `renamed to ${entry.replacement}${since}`
        : `renamed${since}`;
    case "signature":
      return `arguments changed${since}`;
    case "defTag":
      return entry.replacement
        ? `replaced by ${entry.replacement}${since}`
        : `changed${since}`;
    default:
      return entry.replacement
        ? `replaced by ${entry.replacement}${since}`
        : `removed${since}`;
  }
}

/**
 * One hit per place in the source. The scanner reports a name once per
 * catalogue entry, so `Game.version`, both renamed and changed, comes back
 * twice from one line, and counting those would count the line twice.
 */
function luaFinding(
  lua: LuaCompatResult,
  catalogue: CompatEntry[],
): Finding | null {
  const byId = new Map(catalogue.map((e) => [e.id, e]));
  const primary = lua.archives[0];
  let count = 0;
  const details: FindingDetail[] = [];
  for (const file of lua.files) {
    const sites = new Map<string, { text: string; changes: string[] }>();
    for (const hit of file.hits) {
      const key = `${hit.line}:${hit.column}`;
      const site = sites.get(key) ?? { text: hit.text, changes: [] };
      site.changes.push(changeOf(byId.get(hit.entryId)));
      sites.set(key, site);
    }
    if (sites.size === 0) continue;
    count += sites.size;
    details.push({
      heading:
        file.archive === primary ? file.path : `${file.archive}: ${file.path}`,
      lines: [...sites].map(
        ([at, s]) => `${at} ${s.text}, ${s.changes.join(", ")}`,
      ),
    });
  }
  if (count === 0) return null;
  return {
    kind: "lua-api",
    label: "Lua calls to removed or changed APIs",
    severity: "problem",
    count,
    details,
  };
}

/** The value at a dotted path, matching each key without regard to case. */
function lookup(table: Record<string, unknown>, path: string[]): unknown {
  let at: unknown = table;
  for (const part of path) {
    if (!at || typeof at !== "object" || Array.isArray(at)) return undefined;
    const key = Object.keys(at).find((k) => lower(k) === part);
    if (key === undefined) return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

/**
 * Each catalogue `defTag` a unit or weapon definition sets. The catalogue
 * names them the way Lua reads them (`UnitDefs.canCapture`), and the def files
 * use the same name for these, so the name after the table is looked up in
 * each definition. Feature defs are not read by `unitsync_unit_defs`, so
 * `FeatureDefs` tags are never found here.
 */
function defTagFinding(
  defs: CompatDefs,
  catalogue: CompatEntry[],
): Finding | null {
  const weapons = allWeapons(defs);
  const tables: Record<string, Array<[string, Record<string, unknown>]>> = {
    unitdefs: Object.entries(defs.units),
    weapondefs: weapons,
  };

  const details: FindingDetail[] = [];
  for (const entry of catalogue) {
    if (entry.kind !== "defTag") continue;
    const [table, ...path] = entry.name.split(".").map(lower);
    const rows = tables[table];
    if (!rows || path.length === 0) continue;
    const users = rows
      .filter(([, def]) => lookup(def, path) !== undefined)
      .map(([name]) => name)
      .sort();
    if (users.length === 0) continue;
    details.push({
      heading: `${entry.name}, ${changeOf(entry)} (${users.length})`,
      lines: users,
    });
  }
  if (details.length === 0) return null;
  return {
    kind: "def-tags",
    label: "Removed def tags in use",
    severity: "problem",
    count: details.length,
    details,
  };
}
