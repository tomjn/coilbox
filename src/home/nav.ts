import type { NavGroup } from "@picoframe/plugin-sdk";

/**
 * The nav groups the home page offers as tools: the sidebar's groups, minus Home
 * itself and any group that leaves empty.
 *
 * A pure function of the frame's nav, so the Greeting and the tool grid can each
 * answer "is there anything to choose from?" from the same input. Zones must not
 * read each other's state, and this is what lets the greeting say "No tools
 * available yet." without asking the grid whether it drew anything.
 */
export function homeToolGroups(nav: readonly NavGroup[]): NavGroup[] {
  return nav
    .map((g) => ({ ...g, items: g.items.filter((i) => i.to !== "/") }))
    .filter((g) => g.items.length > 0);
}
