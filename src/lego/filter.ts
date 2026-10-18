/**
 * Search and category filtering for the parts pack.
 *
 * The parts browser and the builder's parts strip filter the same way, so the
 * rule lives here once: a part matches when every search term appears somewhere
 * in its name, its tags, its material or the object names it came from.
 *
 * A shape offered in grey, tan and green is three parts, not one shape with a
 * colour option: each has its own texture, so each is independent inventory.
 * Category narrows which of them match, and `null` means every category, a
 * genuine all rather than a stand-in for anything else. A colourway holds one
 * part per shape, so choosing one lists each shape once in that colourway
 * (#4540), and a shape it does not have is left out rather than drawn in
 * another.
 *
 * The result lists a shape's colourways side by side (`partOrder.ts`).
 *
 * Which pack a part came from is a third narrowing of the same kind, and it
 * stacks with the other two rather than replacing them. Parts stay in one grid
 * however many packs are loaded: every pack shares the atlas, so a unit mixes
 * them freely and grouping the grid by pack would only get in the way of
 * finding a shape.
 */

import { useMemo, useState } from "react";

import type { LegoPartInfo, LoadedPack } from "./pack";
import { packShapeGroups, sortByShape } from "./partOrder";
import { SHAPE_KINDS, type ShapeKind } from "./shapes";

/**
 * The category button for generated shapes (#3337). Not a colour, so it cannot
 * be a pack category id: the `@` is not in any. Choosing it lists shapes alone,
 * and choosing a colour lists no shapes, since a shape has no colour of its own.
 * The pack menu does not touch shapes.
 */
export const SHAPES_CATEGORY = "@shapes";

/**
 * The pack tool's category for a part that spans two colourways of the atlas
 * (`scripts/legopack/categorise.mjs`). No colourway would list it, so every
 * colourway does (#4540).
 */
export const MIXED_CATEGORY = "mixed";

/** Whether a part belongs under a category, `null` being every category. */
function inCategory(part: LegoPartInfo, category: string | null): boolean {
  if (category === null || part.category === category) return true;
  return category !== SHAPES_CATEGORY && part.category === MIXED_CATEGORY;
}

/** Shapes match a search by their name, kind and tags, as parts do. */
export function filterShapes(
  kinds: ShapeKind[],
  query: string,
  category: string | null,
): ShapeKind[] {
  if (category !== null && category !== SHAPES_CATEGORY) return [];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return kinds.filter((info) => {
    const haystack =
      `${info.label} ${info.id} ${info.tags.join(" ")}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function filterParts(
  parts: LegoPartInfo[],
  query: string,
  category: string | null,
  packId: string | null = null,
): LegoPartInfo[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return parts.filter((part) => {
    if (!inCategory(part, category)) return false;
    if (packId && part.packId !== packId) return false;
    if (terms.length === 0) return true;
    const haystack =
      `${part.name} ${part.tags.join(" ")} ${part.material} ${part.sourceNames.join(" ")}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export interface PartFilter {
  query: string;
  setQuery: (query: string) => void;
  category: string | null;
  setCategory: (category: string | null) => void;
  /** null means every pack. */
  packId: string | null;
  setPackId: (packId: string | null) => void;
  /** What is left after the search, the category and the pack. */
  parts: LegoPartInfo[];
  /**
   * How many parts the category holds before a search or a pack narrows it,
   * so a colourway counts one part per shape.
   */
  total: number;
  /** The generated shapes left after the search and the category. */
  shapes: ShapeKind[];
}

/** Filter state and its result, for a pack that may not have loaded yet. */
export function usePartFilter(pack: LoadedPack | null): PartFilter {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [packId, setPackId] = useState<string | null>(null);
  const parts = useMemo(
    () =>
      pack
        ? sortByShape(
            filterParts(pack.parts, query, category, packId),
            packShapeGroups(pack),
          )
        : [],
    [pack, query, category, packId],
  );
  const total = useMemo(
    () => (pack ? pack.parts.filter((p) => inCategory(p, category)).length : 0),
    [pack, category],
  );
  // A pack that lists no swatches cannot give a shape its surface, so it
  // offers no shapes.
  const hasSwatches = (pack?.manifest.swatches?.length ?? 0) > 0;
  const shapes = useMemo(
    () => (hasSwatches ? filterShapes(SHAPE_KINDS, query, category) : []),
    [hasSwatches, query, category],
  );
  return {
    query,
    setQuery,
    category,
    setCategory,
    packId,
    setPackId,
    parts,
    total,
    shapes,
  };
}
