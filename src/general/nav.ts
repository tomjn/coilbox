/**
 * When a sidebar item counts as the place you are (issue #2719).
 *
 * picoframe matches a nav item against the current path in one of two ways, and
 * neither is what a section wants. `end: true` lights the item on its own path
 * and nowhere else, so opening a project at `/workshop/:id` puts the sidebar
 * out. Leaving `end` off prefix-matches, which lights `/lego` while you are on
 * `/lego/parts`, a nav item of its own.
 *
 * So the rule is prefix matching minus the paths a sibling item owns, expressed
 * through `activeWhen`, the predicate picoframe ORs with its own match. Name the
 * siblings rather than every child route: the list is short, it is the same list
 * the group already declares, and a new detail route under the section is then
 * lit without anyone having to remember this file.
 */

/** `/lego` and everything under it, but not `/legoland`. */
function isUnder(base: string): (pathname: string) => boolean {
  return (pathname) => pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * An `activeWhen` predicate keeping a nav item lit anywhere inside the section
 * it points at.
 *
 * @param base The item's own path, e.g. `/workshop`.
 * @param siblings Paths inside the section that another nav item points at, and
 * which should therefore light that item rather than this one.
 */
export function insideSection(
  base: string,
  siblings: readonly string[] = [],
): (pathname: string) => boolean {
  const inBase = isUnder(base);
  const inSibling = siblings.map(isUnder);
  return (pathname) =>
    inBase(pathname) && !inSibling.some((matches) => matches(pathname));
}
