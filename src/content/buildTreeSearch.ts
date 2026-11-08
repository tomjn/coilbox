/**
 * Name search over the units of one build tree, for the drawer's search box.
 * The HTML export's runtime (`buildTreeExport/runtime.ts`) carries a plain
 * JavaScript copy of this ranking, and `buildTreeExport.test.ts` checks the two
 * return the same order.
 *
 * It jumps rather than filters: results list the matches and picking one
 * focuses that unit. A filter would hide the tree's shape, which is what the
 * tree is for, and the focus panel already shows what a unit builds and what
 * builds it.
 */

export interface SearchCandidate {
  /** The node id (the unit's internal name, lowercased). */
  id: string;
  /** The name shown on the node. */
  label: string;
}

/** How many results the list shows. */
export const SEARCH_LIMIT = 10;

/**
 * Units whose label or id contains `query`, ignoring case. Matches that start
 * with the query come first, then the rest, each group in label order.
 */
export function searchUnits(
  query: string,
  candidates: SearchCandidate[],
  limit = SEARCH_LIMIT,
): SearchCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const ranked: { c: SearchCandidate; rank: number; label: string }[] = [];
  for (const c of candidates) {
    const label = c.label.toLowerCase();
    const id = c.id.toLowerCase();
    if (label.startsWith(q) || id.startsWith(q)) {
      ranked.push({ c, rank: 0, label });
    } else if (label.includes(q) || id.includes(q)) {
      ranked.push({ c, rank: 1, label });
    }
  }
  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) ||
      (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0),
  );
  return ranked.slice(0, limit).map((r) => r.c);
}
