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
 * genuine all rather than a stand-in for anything else.
 *
 * Which pack a part came from is a third narrowing of the same kind, and it
 * stacks with the other two rather than replacing them. Parts stay in one grid
 * however many packs are loaded: every pack shares the atlas, so a unit mixes
 * them freely and grouping the grid by pack would only get in the way of
 * finding a shape.
 */

import { useMemo, useState } from "react";

import type { LegoPartInfo, LoadedPack } from "./pack";

export function filterParts(
  parts: LegoPartInfo[],
  query: string,
  category: string | null,
  packId: string | null = null,
): LegoPartInfo[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return parts.filter((part) => {
    if (category && part.category !== category) return false;
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
}

/** Filter state and its result, for a pack that may not have loaded yet. */
export function usePartFilter(pack: LoadedPack | null): PartFilter {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [packId, setPackId] = useState<string | null>(null);
  const parts = useMemo(
    () => (pack ? filterParts(pack.parts, query, category, packId) : []),
    [pack, query, category, packId],
  );
  return {
    query,
    setQuery,
    category,
    setCategory,
    packId,
    setPackId,
    parts,
  };
}
