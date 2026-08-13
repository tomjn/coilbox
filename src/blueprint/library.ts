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
  return {
    id: v.id,
    createdAt: typeof v.createdAt === "string" ? v.createdAt : "",
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : "",
    layout,
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
