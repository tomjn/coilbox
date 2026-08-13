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

import { buildingFootprints, type Footprint } from "./footprint";
import type { BaseBlueprint } from "./model";
import {
  type BlueprintPayload,
  parseBlueprintPayload,
  payloadFootprint,
} from "./payload";
import { blueprintFromPayload, blueprintPayload } from "./transfer";

/**
 * Where a layout came from, when it did not start here (issue #1313).
 *
 * A library of thirty layouts where five were drawn by the person and
 * twenty-five came out of somebody's collection is a library where every card
 * looks the same. This is the difference, and it is on the record rather than
 * in the layout on purpose: it is a fact about this copy, not about the shape,
 * so it stays behind when the layout is shared on and it never travels as part
 * of somebody else's blueprint.
 *
 * One kind, because a pack file is the one route that arrives in bulk and so
 * the one where a name on a card does not tell you what you are looking at. A
 * second route is a second member of the union.
 */
export interface BlueprintSource {
  /** Out of a file holding a collection of layouts. */
  kind: "pack";
  /** The file it was taken out of, as the person picked it. */
  file: string;
  /** What it was called in that file, when the library kept it as something
   *  else. Absent when the name came through unchanged. */
  wasCalled?: string;
  /** When it was taken, ISO 8601. */
  at: string;
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

/** A layout's provenance, for one taken out of a pack file. */
export function packSource(
  file: string,
  wasCalled?: string,
  at: Date = new Date(),
): BlueprintSource {
  return {
    kind: "pack",
    file,
    ...(wasCalled ? { wasCalled } : {}),
    at: at.toISOString(),
  };
}

/** The file's own name, without the directories it sat in. Splits on both
 *  separators, because the path came from whichever platform's file dialog. */
export function sourceFileName(source: BlueprintSource): string {
  const parts = source.file.split(/[\\/]/);
  return parts[parts.length - 1] || source.file;
}

/** Where a layout came from, in a line under its name. */
export function sourceSummary(source: BlueprintSource): string {
  const from = `Imported from a file of layouts, ${source.file}.`;
  return source.wasCalled
    ? `${from} It was called "${source.wasCalled}" in there.`
    : from;
}

/** Read a stored source back, or nothing when the record has none and when
 *  what it has is not one. Provenance is a note about the layout rather than
 *  part of it, so a damaged one is dropped and the layout still opens. */
function parseBlueprintSource(value: unknown): BlueprintSource | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (v.kind !== "pack") return undefined;
  if (typeof v.file !== "string" || v.file.trim() === "") return undefined;
  const wasCalled =
    typeof v.wasCalled === "string" && v.wasCalled.trim() !== ""
      ? v.wasCalled
      : undefined;
  return {
    kind: "pack",
    file: v.file,
    ...(wasCalled ? { wasCalled } : {}),
    at: typeof v.at === "string" ? v.at : "",
  };
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
    layout: blueprintPayload(layout, {
      footprintOf: () => ({ x: 1, z: 1 }),
      gameName,
      installed,
    }),
  };
}

/**
 * The record after an edit to its layout.
 *
 * `footprintOf` is the game's units, which is what makes the stored footprints
 * right. Without it the footprints already stored are kept rather than being
 * flattened to one square each: a layout edited on a machine that cannot read
 * the game's units must not come back smaller than it went in.
 */
export function recordWithLayout(
  record: StoredBlueprint,
  layout: BaseBlueprint,
  footprintOf?: (def: string) => Footprint,
): StoredBlueprint {
  const lookup =
    footprintOf ?? ((def: string) => payloadFootprint(record.layout, def));
  return {
    ...record,
    layout: {
      ...(record.layout.game ? { game: record.layout.game } : {}),
      ...blueprintPayload(layout, { footprintOf: lookup }),
    },
  };
}

/** A footprint lookup for a game's units, or nothing when they have not been
 *  read, which is what {@link recordWithLayout} treats as "leave them alone". */
export function footprintsFromUnits(
  units: { name: string; footprintX?: number; footprintZ?: number }[],
): ((def: string) => Footprint) | undefined {
  return units.length > 0 ? buildingFootprints(units) : undefined;
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
