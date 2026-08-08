/**
 * The names of the home layouts this build ships, with no components attached.
 *
 * Split out of `./layout` so that a module which only needs to know whether a
 * name exists can ask without importing the home page. `./layout` holds the
 * components, so importing it pulls in the stacked layout and through it every
 * zone, the lobby connection and the Tauri API. `resolveHome` and the profile
 * health panel both need the question answered and neither renders anything.
 *
 * The split does not create a second list to keep in step. `./layout` types its
 * component table as `Record<LayoutName, ...>`, so a name here with no component
 * there, or a component there under a name that is not here, is a type error.
 * This file is the list, and that file has to match it.
 */

/**
 * Every layout name this build knows, in registry order.
 *
 * A compatibility contract, not decoration: a distribution that pins
 * `home.layout` keeps the screen it was built against when Coilbox changes its
 * default, so a redesign ships as a new name here plus a new default rather than
 * as an edit to `stacked`.
 */
export const LAYOUT_NAMES = ["stacked"] as const;

/** A layout name this build ships. */
export type LayoutName = (typeof LAYOUT_NAMES)[number];

/** The layout used when a profile names none. Moves with us, pins do not. */
export const DEFAULT_LAYOUT: LayoutName = "stacked";

/**
 * A Set, not an array scan or an object literal, so a profile naming "toString"
 * or "constructor" cannot resolve an inherited Object property as a layout. Same
 * reasoning as `config.ts`'s zone list.
 */
const known: ReadonlySet<string> = new Set(LAYOUT_NAMES);

/** Whether a configured name is a layout this build ships. */
export function isLayoutName(name: string): name is LayoutName {
  return known.has(name);
}
