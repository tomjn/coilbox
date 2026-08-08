import type { NavGroup, NavItem } from "@picoframe/plugin-sdk";

/**
 * The nav groups the home page offers as tools: the sidebar's groups, minus Home
 * itself and any group that leaves empty.
 *
 * A pure function of the frame's nav, so the grid draws exactly the groups the
 * sidebar shows.
 */
export function homeToolGroups(nav: readonly NavGroup[]): NavGroup[] {
  return nav
    .map((g) => ({ ...g, items: g.items.filter((i) => i.to !== "/") }))
    .filter((g) => g.items.length > 0);
}

/** A group's items, split by the two kinds of card the grid draws for them. */
export interface GroupCards {
  /** Items that go somewhere inside Coilbox. One card each. */
  tools: NavItem[];
  /** Items that leave for the browser. One card between them all. */
  links: NavItem[];
}

/**
 * Split one group's items into the tools that each earn a card and the external
 * links that share one.
 *
 * A link out of the app is not the same weight as a tool and does not earn the
 * same footprint (issue #1042): before this, a distribution declaring six links
 * in `profile.links` filled most of a row of the home page with them.
 *
 * `href` is the test, matching how the tool card already decides between a
 * router `Link` and a button that opens the system browser. It catches both
 * kinds of external item: a distribution's `profile.links`, and the reference
 * links the Animation, Mapconv and Lego plugins declare with `sidebar: false`.
 *
 * It is also what makes "the grid drew a tool card" the right question for the
 * Greeting to ask (#1057, #1066). Only the items this puts in `tools` reach
 * `ToolCard`, so only they can leave a `data-tool-card` marker behind.
 */
export function splitGroupItems(items: readonly NavItem[]): GroupCards {
  return {
    tools: items.filter((i) => !i.href),
    links: items.filter((i) => Boolean(i.href)),
  };
}
