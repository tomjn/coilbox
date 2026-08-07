import type { ComponentType } from "react";
import type { Profile } from "../profile/profile";
import type { HomeEntry } from "./config";
import StackedLayout from "./StackedLayout";

/**
 * What every layout is handed: the page the profile resolved to, and the raw
 * backdrop value for it to paint.
 *
 * Layouts take the resolved config as props rather than reading the profile, so
 * a layout renders the same way in a test as it does in the app, and so the
 * schema is parsed once per page rather than once per layout.
 */
export interface HomeLayoutProps {
  /** The zones to render, in order. See `./config`. */
  entries: readonly HomeEntry[];
  /** The profile's `home.background`, unvalidated. See `./background`. */
  background: unknown;
}

/**
 * Which arm of the home page a profile selects.
 *
 * - `"welcome"`: the distribution ships its own markup, which takes the whole
 *   page (plus the onboarding cards above or below it).
 * - `"layout"`: Coilbox's own home, assembled from zones by a named layout.
 */
export type HomeMode = "welcome" | "layout";

/**
 * Pick the home arm for a profile. A `welcome` of any shape wins, matching the
 * gate `main.tsx` used before Coilbox owned `/`. A distribution that ships
 * `welcome: {}` still gets the (empty) branded page rather than silently
 * falling back to the tool grid.
 */
export function homeMode(profile: Pick<Profile, "welcome">): HomeMode {
  return profile.welcome ? "welcome" : "layout";
}

/** The layout used when a profile names none. Moves with us, pins do not. */
export const DEFAULT_LAYOUT = "stacked";

/**
 * Named home layouts. A layout arranges the zones, and the zones themselves stay
 * layout-agnostic so a future arrangement can reuse them unchanged.
 *
 * The names are a compatibility contract, not decoration. A distribution that
 * pins `home.layout` keeps the screen it was built against when Coilbox changes
 * its default, so a redesign ships as a new entry here plus a new default rather
 * than as an edit to `stacked`.
 *
 * A Map, not an object literal, so a profile naming "toString" or "constructor"
 * cannot resolve an inherited Object property as a layout.
 */
const layouts = new Map<string, ComponentType<HomeLayoutProps>>([
  [DEFAULT_LAYOUT, StackedLayout],
]);

/**
 * Resolve a configured layout name to its component. An unset or unrecognised
 * name falls back to the default, so a profile naming a layout from a newer
 * Coilbox gets today's home rather than a blank page.
 *
 * An unrecognised name warns, because it is the one case a distribution author
 * cannot see: the page still renders, so without the warning a typo looks like
 * the pin working.
 */
export function resolveLayout(name?: string): ComponentType<HomeLayoutProps> {
  if (name === undefined) return StackedLayout;
  const layout = layouts.get(name);
  if (layout) return layout;
  console.warn(
    `home: unknown layout "${name}", using "${DEFAULT_LAYOUT}". This build ships:`,
    layoutNames(),
  );
  return StackedLayout;
}

/** Layout names this build knows about. Exported for tests and diagnostics. */
export function layoutNames(): string[] {
  return [...layouts.keys()];
}
