/**
 * The blueprint library: what one kept layout is, on disk and in hand (issue
 * #1415).
 *
 * A blueprint used to exist only inside the mission it was drawn in, so the only
 * way to reach one was to open that scenario. This is the model behind the place
 * they live instead, `content/blueprints`, and it is deliberately thin: a stored
 * layout is the same {@link BlueprintPayload} a shared one travels as, plus an
 * id and the two timestamps a library needs to order itself by.
 *
 * That the on-disk shape is the wire shape is the decision worth stating. A
 * library entry and a shared layout hold exactly the same facts, so giving them
 * two shapes would mean two readers, two parsers and a conversion between them
 * that can only lose something. It also means the footprints travel with the
 * layout here for the same reason they travel to the hub: a footprint comes from
 * unitsync, and a list of thirty cards cannot each run a unitsync read to find
 * out how big a solar collector is.
 *
 * Pure. The reading and writing is `./store.ts`, and the pages are
 * `./pages/`.
 */

import { declaredFootprints, type Footprint } from "./footprint";
import type { BaseBlueprint } from "./model";
import {
  type BlueprintPayload,
  declaredFootprint,
  parseBlueprintPayload,
} from "./payload";
import { blueprintFromPayload, blueprintPayload } from "./transfer";

/**
 * Where a layout came from, when it did not start here (issues #1313, #1473).
 *
 * A library of thirty layouts where five were drawn by the person and
 * twenty-five came out of somebody's collection is a library where every card
 * looks the same. This is the difference, and it is on the record rather than
 * in the layout on purpose: it is a fact about this copy, not about the shape,
 * so it stays behind when the layout is shared on and it never travels as part
 * of somebody else's blueprint. That is also what keeps a path off your own
 * disk out of a stranger's file.
 *
 * One member per way in, because each way knows a different amount and a
 * record that flattened them would be claiming the same thing about all of
 * them. A pack file and a single file name themselves, a hub item names its id
 * and whoever published it, a scenario names the mission the layout was lifted
 * out of, and a code knows almost nothing, which is worth saying plainly rather
 * than dressing up.
 */
export type BlueprintSource =
  | PackSource
  | FileSource
  | CodeSource
  | HubSource
  | ScenarioSource;

/** What every way in knows. */
interface ArrivedHere {
  /** What it was called where it came from, when the library kept it as
   *  something else. Absent when the name came through unchanged. */
  wasCalled?: string;
  /** When it arrived, ISO 8601. */
  at: string;
}

/** Out of a file holding a collection of layouts. */
export interface PackSource extends ArrivedHere {
  kind: "pack";
  /** The file it was taken out of, as the person picked it. */
  file: string;
}

/** Out of a file holding this layout on its own. */
export interface FileSource extends ArrivedHere {
  kind: "file";
  /** The file it was read out of, as the person picked it. */
  file: string;
}

/** Out of a pasted code or a `coilbox://` link. */
export interface CodeSource extends ArrivedHere {
  kind: "code";
}

/** Out of the community hub. */
export interface HubSource extends ArrivedHere {
  kind: "hub";
  /** The hub item's id. The rest of what the hub knows is the hub's to keep,
   *  in `../hub/importRecord.ts`, so this holds the key and not a copy. */
  item: string;
  /** Who published it, when the screen that started the import had read it.
   *  Absent for a link followed from anywhere else. */
  author?: string;
}

/** Saved out of a scenario, where it was drawn as part of a mission. */
export interface ScenarioSource extends ArrivedHere {
  kind: "scenario";
  /** The scenario document's id. */
  scenario: string;
  /** What that scenario is called, for a line a person can read. Absent when
   *  the scenario had no name. */
  scenarioName?: string;
}

/** What the library keeps for one layout. */
export interface StoredBlueprint {
  /** Minted here and never taken from a shared file, so importing the same
   *  layout twice makes two entries rather than one overwriting the other. */
  id: string;
  /** ISO timestamps, stamped by `./store.ts` on write. Empty on a record that
   *  has not been saved yet. */
  createdAt: string;
  updatedAt: string;
  layout: BlueprintPayload;
  /** Where this copy came from. Absent on a layout drawn here, which is what
   *  every layout was before packs. */
  source?: BlueprintSource;
}

/** What every constructor here adds, so none of them has to repeat it. */
function arrived(wasCalled: string | undefined, at: Date): ArrivedHere {
  return { ...(wasCalled ? { wasCalled } : {}), at: at.toISOString() };
}

/** A layout's provenance, for one taken out of a pack file. */
export function packSource(
  file: string,
  wasCalled?: string,
  at: Date = new Date(),
): PackSource {
  return { kind: "pack", file, ...arrived(wasCalled, at) };
}

/** For one read out of a file holding it on its own. */
export function fileSource(
  file: string,
  wasCalled?: string,
  at: Date = new Date(),
): FileSource {
  return { kind: "file", file, ...arrived(wasCalled, at) };
}

/** For one out of a pasted code or a link, which is all anybody can say about
 *  it: a code carries the layout and nothing about where it has been. */
export function codeSource(
  wasCalled?: string,
  at: Date = new Date(),
): CodeSource {
  return { kind: "code", ...arrived(wasCalled, at) };
}

/** For one imported from the hub. */
export function hubSource(
  item: { item: string; author?: string },
  wasCalled?: string,
  at: Date = new Date(),
): HubSource {
  return {
    kind: "hub",
    item: item.item,
    ...(item.author ? { author: item.author } : {}),
    ...arrived(wasCalled, at),
  };
}

/** For one saved out of a scenario. */
export function scenarioSource(
  scenario: { id: string; name?: string },
  wasCalled?: string,
  at: Date = new Date(),
): ScenarioSource {
  return {
    kind: "scenario",
    scenario: scenario.id,
    ...(scenario.name ? { scenarioName: scenario.name } : {}),
    ...arrived(wasCalled, at),
  };
}

/** A file's own name, without the directories it sat in. Splits on both
 *  separators, because the path came from whichever platform's file dialog. */
export function sourceFileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Where a layout came from, short enough to sit on a card. */
export function sourceLabel(source: BlueprintSource): string {
  switch (source.kind) {
    case "pack":
    case "file":
      return `From ${sourceFileName(source.file)}`;
    case "code":
      return "From a shared code";
    case "hub":
      return source.author
        ? `From ${source.author} on the hub`
        : "From the hub";
    default:
      return source.scenarioName
        ? `From ${source.scenarioName}`
        : "From a scenario";
  }
}

/** Where a layout came from, in a line under its name. */
export function sourceSummary(source: BlueprintSource): string {
  const from = summaryOf(source);
  return source.wasCalled
    ? `${from} It was called "${source.wasCalled}" in there.`
    : from;
}

function summaryOf(source: BlueprintSource): string {
  switch (source.kind) {
    case "pack":
      return `Imported from a file of layouts, ${source.file}.`;
    case "file":
      return `Imported from the file ${source.file}.`;
    case "code":
      // The honest answer rather than a shrug. A code is the layout and
      // nothing else, so there is no file, no author and no site to name, and
      // saying so beats a card that looks like it forgot.
      return "Imported from a code somebody shared. A code carries the layout and nothing about where it came from, so that is the whole of what is known about it.";
    case "hub":
      return source.author
        ? `Imported from the community hub, published by ${source.author}.`
        : "Imported from the community hub.";
    default:
      return source.scenarioName
        ? `Saved out of the scenario "${source.scenarioName}".`
        : "Saved out of a scenario.";
  }
}

/** Read a stored source back, or nothing when the record has none and when
 *  what it has is not one. Provenance is a note about the layout rather than
 *  part of it, so a damaged one is dropped and the layout still opens, and so
 *  is one recorded by a later version of coilbox naming a way in this one has
 *  never heard of. */
function parseBlueprintSource(value: unknown): BlueprintSource | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const text = (key: string): string | undefined => {
    const held = v[key];
    return typeof held === "string" && held.trim() !== "" ? held : undefined;
  };
  const at = typeof v.at === "string" ? v.at : "";
  const wasCalled = text("wasCalled");
  const rest: ArrivedHere = { ...(wasCalled ? { wasCalled } : {}), at };
  const file = text("file");
  switch (v.kind) {
    case "pack":
      return file ? { kind: "pack", file, ...rest } : undefined;
    case "file":
      return file ? { kind: "file", file, ...rest } : undefined;
    case "code":
      return { kind: "code", ...rest };
    case "hub": {
      const item = text("item");
      const author = text("author");
      return item
        ? { kind: "hub", item, ...(author ? { author } : {}), ...rest }
        : undefined;
    }
    case "scenario": {
      const scenario = text("scenario");
      const scenarioName = text("scenarioName");
      return scenario
        ? {
            kind: "scenario",
            scenario,
            ...(scenarioName ? { scenarioName } : {}),
            ...rest,
          }
        : undefined;
    }
    default:
      return undefined;
  }
}

/** What a layout is called when its author has not said. */
export const UNTITLED = "Untitled layout";

/** The archive name of the game a layout's unit names belong to, or empty when
 *  it names none. */
export function recordGameName(record: StoredBlueprint): string {
  return record.layout.game?.name ?? "";
}

/** The layout as the editor wants it: the record's own id on the stored
 *  geometry. */
export function libraryLayout(record: StoredBlueprint): BaseBlueprint {
  return { id: record.id, ...blueprintFromPayload(record.layout) };
}

/**
 * A fresh, empty layout for a game.
 *
 * Timestamps are left empty for the store to stamp, the same way a new scenario
 * leaves them. `installed` is only read for the game's modinfo shortname, which
 * is what lets two layouts for different builds of one game be recognised as
 * being for the same game.
 */
export function newStoredBlueprint(
  name: string,
  gameName: string,
  installed: readonly { name: string; info?: Record<string, string> }[] = [],
): StoredBlueprint {
  const layout: BaseBlueprint = { id: "", name, buildings: [] };
  return {
    id: crypto.randomUUID(),
    createdAt: "",
    updatedAt: "",
    // No buildings, so there is nothing to state a footprint for.
    layout: blueprintPayload(layout, { gameName, installed }),
  };
}

/**
 * A copy of a layout, to make a variant of it (issue #1452).
 *
 * A second opening is usually the first one with a building moved, so the way
 * to one is the layout you already have under a new name. The copy is a fresh
 * id over the same payload, which is what makes it a separate entry rather than
 * a second name for the same one, and it is deep so that editing it never
 * reaches the original. The name is counted up past what is taken, the same way
 * a new layout's is, so a copy of "Opening solars" is "Opening solars 2".
 *
 * Timestamps are left for the store to stamp, so a copy is the most recently
 * edited thing in the library and opens at the top of it.
 */
export function duplicatedBlueprint(
  record: StoredBlueprint,
  taken: Iterable<string>,
): StoredBlueprint {
  return {
    id: crypto.randomUUID(),
    createdAt: "",
    updatedAt: "",
    layout: {
      ...structuredClone(record.layout),
      name: uniqueLayoutName(record.layout.name, taken),
    },
  };
}

/**
 * The record after an edit to its layout.
 *
 * `footprintOf` is the game's units, which is what makes the stored footprints
 * right. What that cannot answer for falls back to what the layout already
 * carried, and then to nothing at all: a layout edited on a machine that cannot
 * read the game's units must not come back smaller than it went in, and a def
 * neither of them knows is one nothing here can honestly state (issue #1463).
 */
export function recordWithLayout(
  record: StoredBlueprint,
  layout: BaseBlueprint,
  footprintOf?: (def: string) => Footprint | undefined,
): StoredBlueprint {
  const lookup = (def: string) =>
    footprintOf?.(def) ?? declaredFootprint(record.layout, def);
  return {
    ...record,
    layout: {
      ...(record.layout.game ? { game: record.layout.game } : {}),
      ...blueprintPayload(layout, { footprintOf: lookup }),
    },
  };
}

/** A footprint lookup for a game's units, or nothing when they have not been
 *  read, which is what {@link recordWithLayout} treats as "leave them alone".
 *  It answers nothing for a def the game has not got, which is the same thing
 *  said about one unit rather than about all of them. */
export function footprintsFromUnits(
  units: { name: string; footprintX?: number; footprintZ?: number }[],
): ((def: string) => Footprint | undefined) | undefined {
  return units.length > 0 ? declaredFootprints(units) : undefined;
}

/**
 * Read one stored document, or null when it is not one.
 *
 * Never throws: this runs on every file in a directory a person can put things
 * in, and one unreadable document must not empty the library.
 */
export function parseStoredBlueprintJson(json: string): StoredBlueprint | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id.trim() === "") return null;
  const layout = parseBlueprintPayload(v.layout);
  if (!layout) return null;
  const source = parseBlueprintSource(v.source);
  return {
    id: v.id,
    createdAt: typeof v.createdAt === "string" ? v.createdAt : "",
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : "",
    layout,
    ...(source ? { source } : {}),
  };
}

/** Most recently edited first, which is what a library of things you are
 *  working on should open on. */
export function sortLibrary(records: StoredBlueprint[]): StoredBlueprint[] {
  return [...records].sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.layout.name.localeCompare(b.layout.name),
  );
}

/** Every game named by a layout in the library, once each, in name order. */
export function libraryGames(records: StoredBlueprint[]): string[] {
  const names = new Set<string>();
  for (const record of records) {
    const name = recordGameName(record);
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * `name` if nothing else is called that, and otherwise the same name counted
 * up.
 *
 * Two layouts of one name are legal, because the id is what tells them apart,
 * but a library where three cards say "Untitled layout" is a library nobody can
 * use. Case-insensitive, because two names differing only in case read as the
 * same name.
 */
export function uniqueLayoutName(
  name: string,
  taken: Iterable<string>,
): string {
  const wanted = name.trim() || UNTITLED;
  const used = new Set([...taken].map((t) => t.trim().toLowerCase()));
  if (!used.has(wanted.toLowerCase())) return wanted;
  for (let at = 2; ; at++) {
    const candidate = `${wanted} ${at}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
