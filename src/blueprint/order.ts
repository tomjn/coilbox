/**
 * A blueprint written out as a plain build order (issue #1418).
 *
 * A build order is not a second kind of thing. It is a blueprint whose sequence
 * was meant, so writing one out is a matter of dropping what a person reading a
 * build order does not want: the positions, the facings, and anything the
 * mission put on top. What is left is the sequence of unit names, one per line,
 * which is the form a build order is posted, pasted and read in.
 *
 * A layout that never claimed its order means anything has no build order to
 * write out, and says so with nothing rather than with its incidental order.
 */

/** The build order as text: one unit name per line, in order. Empty for a
 *  layout whose order was not meant, and for one with nothing in it. */
export function buildOrderText(layout: {
  ordered?: boolean;
  buildings: { def: string }[];
}): string {
  if (!layout.ordered) return "";
  return layout.buildings.map((building) => building.def).join("\n");
}
