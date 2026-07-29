/**
 * Search and colourway filtering for the parts pack.
 *
 * The parts browser and the builder's parts strip filter the same way, so the
 * rule lives here once: a part matches when every search term appears somewhere
 * in its name, its tags, its material or the object names it came from.
 */

import { useMemo, useState } from "react";

import { type LegoPartInfo, type LoadedPack, oneOfEachShape } from "./pack";

export function filterParts(
  parts: LegoPartInfo[],
  query: string,
  colourway: string | null,
): LegoPartInfo[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matching = parts.filter((part) => {
    if (colourway && part.colourway !== colourway) return false;
    if (terms.length === 0) return true;
    const haystack =
      `${part.name} ${part.tags.join(" ")} ${part.material} ${part.sourceNames.join(" ")}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
  // Most pieces exist in all three colourways. Showing every one makes the grid
  // three times longer without offering three times the choice, so it collapses
  // to one per shape until a colourway is picked.
  return colourway ? matching : oneOfEachShape(matching);
}

export interface PartFilter {
  query: string;
  setQuery: (query: string) => void;
  colourway: string | null;
  setColourway: (colourway: string | null) => void;
  /** What is left after the search and the colourway. */
  parts: LegoPartInfo[];
}

/** Filter state and its result, for a pack that may not have loaded yet. */
export function usePartFilter(pack: LoadedPack | null): PartFilter {
  const [query, setQuery] = useState("");
  const [colourway, setColourway] = useState<string | null>(null);
  const parts = useMemo(
    () => (pack ? filterParts(pack.parts, query, colourway) : []),
    [pack, query, colourway],
  );
  return { query, setQuery, colourway, setColourway, parts };
}
