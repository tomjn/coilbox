import type { ComponentType } from "react";
import type { Profile } from "../profile/profile";
import type { HomeEntry } from "./config";
import {
  DEFAULT_LAYOUT,
  isLayoutName,
  LAYOUT_NAMES,
  type LayoutName,
} from "./layoutNames";
import StackedLayout from "./StackedLayout";
import type { SuggestedPlacement } from "./suggestedMap";

export { DEFAULT_LAYOUT } from "./layoutNames";

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
  /**
   * Where the suggested map card goes, which the page decides above the layout
   * and which no zone can answer for itself. See `./suggestedMap`.
   *
   * Omitted means `"cards"`: the card sits where the profile listed its zone.
   * That is what a layout host that says nothing gets, and what the layout drew
   * before promotion existed.
   */
  suggested?: SuggestedPlacement;
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

/**
 * The component for each layout `./layoutNames` lists. A layout arranges the
 * zones, and the zones themselves stay layout-agnostic so a future arrangement
 * can reuse them unchanged.
 *
 * Keyed by {@link LayoutName} rather than by `string`, so the compiler holds this
 * table and the name list to each other: a name with no component here does not
 * type, and a component here under a name that is not on the list does not
 * either. That is what lets `resolveHome` check a configured name against the
 * list without importing this file and the whole home page with it.
 *
 * Only ever read through {@link isLayoutName}, so a profile naming "toString" or
 * "constructor" cannot reach an inherited Object property through it.
 */
const layouts: Readonly<Record<LayoutName, ComponentType<HomeLayoutProps>>> = {
  stacked: StackedLayout,
};

/**
 * Resolve a configured layout name to its component. An unset or unrecognised
 * name falls back to the default, so a profile naming a layout from a newer
 * Coilbox gets today's home rather than a blank page.
 *
 * Silent, because `resolveHome` has already checked the name against the same
 * list and said what it was dropping (see `./config`). Complaining again here
 * would put the same mistake on the console twice and, worse, from a second call
 * site the profile health panel cannot see.
 */
export function resolveLayout(name?: string): ComponentType<HomeLayoutProps> {
  return layouts[
    name !== undefined && isLayoutName(name) ? name : DEFAULT_LAYOUT
  ];
}

/** Layout names this build knows about. Exported for tests and diagnostics. */
export function layoutNames(): string[] {
  return [...LAYOUT_NAMES];
}
