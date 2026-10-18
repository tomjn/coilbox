/**
 * The inventory's one category menu (#4538), whose entries follow the tab.
 *
 * All lists the colourways and then the module categories, Parts the
 * colourways and Shapes, Modules the module categories and Uncategorised. A
 * colourway narrows the parts and hides the modules, and a module category
 * does the reverse, because neither means anything to the other kind.
 *
 * Each choice is held as the part filter's or the module filter's category, so
 * the rules in `filter.ts` and `moduleFilter.ts` do the narrowing.
 */

import { SHAPES_CATEGORY } from "./filter";
import type { InventoryKind } from "./inventory";
import type { LegoProject } from "./model";
import { categoriesInUse, UNCATEGORISED } from "./moduleFilter";
import type { LoadedPack } from "./pack";

export type InventoryCategory =
  | { kind: "colourway"; id: string }
  | { kind: "shapes" }
  | { kind: "module"; name: string }
  | { kind: "uncategorised" }
  | null;

/** Radix needs a non-empty value for every entry, and no two alike. */
export const EVERY_CATEGORY = "@all";
const SHAPES = "@shapes";
const NONE = "@none";
const COLOURWAY = "colourway:";
const MODULE = "module:";

export function categoryValue(category: InventoryCategory): string {
  if (category === null) return EVERY_CATEGORY;
  switch (category.kind) {
    case "colourway":
      return COLOURWAY + category.id;
    case "shapes":
      return SHAPES;
    case "module":
      return MODULE + category.name;
    case "uncategorised":
      return NONE;
  }
}

export function categoryFromValue(value: string): InventoryCategory {
  if (value === SHAPES) return { kind: "shapes" };
  if (value === NONE) return { kind: "uncategorised" };
  if (value.startsWith(COLOURWAY)) {
    return { kind: "colourway", id: value.slice(COLOURWAY.length) };
  }
  if (value.startsWith(MODULE)) {
    return { kind: "module", name: value.slice(MODULE.length) };
  }
  return null;
}

/** The choice the two filters' categories add up to. */
export function categoryOf(
  partCategory: string | null,
  moduleCategory: string | null,
): InventoryCategory {
  if (partCategory === SHAPES_CATEGORY) return { kind: "shapes" };
  if (partCategory !== null) return { kind: "colourway", id: partCategory };
  if (moduleCategory === UNCATEGORISED) return { kind: "uncategorised" };
  if (moduleCategory !== null) return { kind: "module", name: moduleCategory };
  return null;
}

/**
 * Whether a tab offers the choice, so a tab change drops one it does not. Game
 * units have no categories, so their tab offers only "All categories".
 */
export function offeredOn(
  kind: InventoryKind,
  category: InventoryCategory,
): boolean {
  if (category === null) return true;
  if (kind === "units") return false;
  switch (category.kind) {
    case "colourway":
      return kind !== "modules";
    case "shapes":
      return kind === "parts";
    case "module":
      return kind !== "parts";
    case "uncategorised":
      return kind === "modules";
  }
}

export interface MenuEntry {
  value: string;
  label: string;
  /** The pack category whose chip it carries, for a colourway. */
  colourway?: string;
}

export interface MenuGroup {
  /** A heading over the group, on All where two kinds share the menu. */
  label?: string;
  entries: MenuEntry[];
}

/**
 * What the menu lists on a tab, after "All categories", which is all Game
 * units has. `current` is listed
 * even when nothing uses it any more, so the menu can still name it.
 */
export function categoryMenu({
  kind,
  pack,
  compounds,
  current,
  shapes,
}: {
  kind: InventoryKind;
  pack: LoadedPack;
  compounds: LegoProject[];
  current: InventoryCategory;
  /** Whether the grid lists generated shapes, which Parts then offers. */
  shapes: boolean;
}): MenuGroup[] {
  const colourways: MenuEntry[] = pack.manifest.categories.map((c) => ({
    value: categoryValue({ kind: "colourway", id: c.id }),
    label: c.label,
    colourway: c.id,
  }));
  const names = categoriesInUse(compounds);
  if (current?.kind === "module" && !names.includes(current.name)) {
    names.push(current.name);
  }
  const moduleCategories: MenuEntry[] = names.map((name) => ({
    value: categoryValue({ kind: "module", name }),
    label: name,
  }));
  const groups: MenuGroup[] = [];
  if (kind === "all") {
    if (colourways.length > 0) {
      groups.push({ label: "Colourways", entries: colourways });
    }
    if (moduleCategories.length > 0) {
      groups.push({ label: "Module categories", entries: moduleCategories });
    }
  } else if (kind === "parts") {
    const shapeEntry =
      shapes || current?.kind === "shapes"
        ? [{ value: categoryValue({ kind: "shapes" }), label: "Shapes" }]
        : [];
    groups.push({ entries: [...colourways, ...shapeEntry] });
  } else if (kind === "modules") {
    const none =
      compounds.some((c) => !c.category) || current?.kind === "uncategorised"
        ? [
            {
              value: categoryValue({ kind: "uncategorised" }),
              label: "Uncategorised",
            },
          ]
        : [];
    groups.push({ entries: [...moduleCategories, ...none] });
  }
  return groups.filter((group) => group.entries.length > 0);
}
