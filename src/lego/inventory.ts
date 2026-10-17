/**
 * The builder's one inventory (issue #3306): parts and modules in a single list
 * with a kind filter, a "Recent" view and a "Favourites" view.
 *
 * Recent and favourite items are stored as app settings, not in a unit, so they
 * follow the user between units. They hold references (a kind and an id), never
 * copies, so an item that is no longer installed simply stops matching and
 * drops out of the view without an error.
 *
 * Skeletons (milestone 63) do not exist yet. A third kind is added by widening
 * `InventoryKind`, giving it a `kind` in `InventoryRef`, and one more call to
 * `inList` in the view hook.
 */

import { useSetting } from "@picoframe/frame";
import { useMemo, useState } from "react";

import { type PartFilter, usePartFilter } from "./filter";
import type { LegoProject } from "./model";
import { type ModuleFilter, useModuleFilter } from "./moduleFilter";
import type { LegoPartInfo, LoadedPack } from "./pack";

/**
 * How many recent items are kept. A choice, not a measurement: 24 fills whole
 * rows at 2, 3, 4, 6 and 8 columns, so the last row is never ragged, and it
 * covers the parts and modules of a working session while staying short
 * enough to scan without a search.
 */
export const RECENT_LIMIT = 24;

export type ItemKind = "part" | "module";

/**
 * What the kind filter shows. "units" is the unit's own game's units (#3264),
 * a source of parts rather than an item kind: it has no recent or favourites
 * and no `ItemKind`, and is drawn by its own browser.
 */
export type InventoryKind = "all" | "parts" | "modules" | "units";

/** Which items of the kind: everything, the ones used lately, or the starred. */
export type InventoryList = "all" | "recent" | "favourites";

export interface InventoryRef {
  kind: ItemKind;
  id: string;
}

/** Part ids and module ids are each unique, but not across the two. */
export function refKey(ref: InventoryRef): string {
  return `${ref.kind}:${ref.id}`;
}

/** Stored lists are written by hand-editable settings, so read them warily. */
export function parseRefs(raw: unknown): InventoryRef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const refs: InventoryRef[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { kind, id } = item as { kind?: unknown; id?: unknown };
    if ((kind !== "part" && kind !== "module") || typeof id !== "string")
      continue;
    const ref: InventoryRef = { kind, id };
    if (seen.has(refKey(ref))) continue;
    seen.add(refKey(ref));
    refs.push(ref);
  }
  return refs;
}

/** The item moved to the front, once, with the list cut to `limit`. */
export function withRecent(
  recent: InventoryRef[],
  ref: InventoryRef,
  limit: number = RECENT_LIMIT,
): InventoryRef[] {
  const key = refKey(ref);
  return [ref, ...recent.filter((r) => refKey(r) !== key)].slice(0, limit);
}

/** The item added to the favourites, or removed if it was already there. */
export function withToggled(
  favourites: InventoryRef[],
  ref: InventoryRef,
): InventoryRef[] {
  const key = refKey(ref);
  return favourites.some((r) => refKey(r) === key)
    ? favourites.filter((r) => refKey(r) !== key)
    : [...favourites, ref];
}

/**
 * The items that belong in the chosen list. "Recent" is newest first, which is
 * the order of `recent`, not of `items`. Anything in `recent` that is not in
 * `items` (uninstalled, or hidden by a search) is skipped.
 */
export function inList<T>(
  items: T[],
  list: InventoryList,
  kind: ItemKind,
  idOf: (item: T) => string,
  recent: InventoryRef[],
  favourites: InventoryRef[],
): T[] {
  if (list === "all") return items;
  if (list === "favourites") {
    const starred = new Set(
      favourites.filter((r) => r.kind === kind).map((r) => r.id),
    );
    return items.filter((item) => starred.has(idOf(item)));
  }
  const byId = new Map(items.map((item) => [idOf(item), item]));
  const ordered: T[] = [];
  for (const ref of recent) {
    if (ref.kind !== kind) continue;
    const item = byId.get(ref.id);
    if (item) ordered.push(item);
  }
  return ordered;
}

export interface Inventory {
  recent: InventoryRef[];
  favourites: InventoryRef[];
  /** Call when an item has been added to a unit. */
  record: (ref: InventoryRef) => void;
  toggleFavourite: (ref: InventoryRef) => void;
  isFavourite: (ref: InventoryRef) => boolean;
}

const NONE: InventoryRef[] = [];

/** The recent and favourite lists, kept as app settings. */
export function useInventory(): Inventory {
  const [storedRecent, setRecent] = useSetting<unknown>(
    "lego.inventory.recent",
    NONE,
  );
  const [storedFavourites, setFavourites] = useSetting<unknown>(
    "lego.inventory.favourites",
    NONE,
  );
  const recent = useMemo(() => parseRefs(storedRecent), [storedRecent]);
  const favourites = useMemo(
    () => parseRefs(storedFavourites),
    [storedFavourites],
  );
  return useMemo(
    () => ({
      recent,
      favourites,
      record: (ref) => setRecent(withRecent(recent, ref)),
      toggleFavourite: (ref) => setFavourites(withToggled(favourites, ref)),
      isFavourite: (ref) => favourites.some((r) => refKey(r) === refKey(ref)),
    }),
    [recent, favourites, setRecent, setFavourites],
  );
}

export interface InventoryView {
  kind: InventoryKind;
  setKind: (kind: InventoryKind) => void;
  list: InventoryList;
  setList: (list: InventoryList) => void;
  /** One search box for both kinds. */
  query: string;
  setQuery: (query: string) => void;
  partFilter: PartFilter;
  moduleFilter: ModuleFilter;
  inventory: Inventory;
  /** What to draw: empty when the kind filter excludes it. */
  parts: LegoPartInfo[];
  modules: LegoProject[];
}

/**
 * The inventory's state and what it currently shows. Search runs through the
 * same rules the parts strip and the module list already had, then the list
 * (all, recent, favourites) narrows the result, then the kind filter hides a
 * whole kind.
 */
export function useInventoryView(
  pack: LoadedPack | null,
  compounds: LegoProject[],
): InventoryView {
  const [kind, setKind] = useState<InventoryKind>("all");
  const [list, setList] = useState<InventoryList>("all");
  const partFilter = usePartFilter(pack);
  const moduleFilter = useModuleFilter(compounds);
  const inventory = useInventory();

  const parts = useMemo(
    () =>
      kind === "modules" || kind === "units"
        ? []
        : inList(
            partFilter.parts,
            list,
            "part",
            (part) => part.id,
            inventory.recent,
            inventory.favourites,
          ),
    [kind, list, partFilter.parts, inventory.recent, inventory.favourites],
  );
  const modules = useMemo(
    () =>
      kind === "parts" || kind === "units"
        ? []
        : inList(
            moduleFilter.modules,
            list,
            "module",
            (module) => module.id,
            inventory.recent,
            inventory.favourites,
          ),
    [kind, list, moduleFilter.modules, inventory.recent, inventory.favourites],
  );

  return {
    kind,
    setKind,
    list,
    setList,
    query: partFilter.query,
    setQuery: (query) => {
      partFilter.setQuery(query);
      moduleFilter.setQuery(query);
    },
    partFilter,
    moduleFilter,
    inventory,
    parts,
    modules,
  };
}
