import type { GameFilter } from "../profile/profile";
import {
  fetchHubItems,
  type HubFilters,
  type HubItem,
  type HubResult,
} from "./api";

/**
 * What the browse screen shows, once a distribution's `gameFilter` has had its
 * say (issue #1362). A profile that pins Coilbox to one game pins the hub to it
 * too, rather than leaving a player of a modded game to scroll a gallery of
 * everybody else's.
 *
 * The pin is applied to what comes back, never sent as `game=`. The hub stores a
 * game as a versioned string ("SplinterFaction 0.1.78"), so a name pinned in a
 * profile would go stale at the next release. `gameFilter` is a predicate for
 * exactly that reason.
 *
 * Which means the server's own paging no longer describes what the reader sees:
 * its count is of the whole gallery and its page boundaries fall in the wrong
 * places. So a pinned session reads the pages it needs in one go, filters them,
 * and pages the result itself, and every number on screen is then about the list
 * on screen. Unpinned, nothing changes: one request, the server's paging.
 *
 * A type-only import of {@link GameFilter} keeps this module free of the plugin
 * commands `profile.ts` pulls in, so it stays unit-testable. Callers pass the
 * matcher in, from `getGameMatcher()`.
 */

/**
 * How many pages of the hub a pinned session will read before it stops. A pinned
 * distribution is a small slice of a hub, and 20 pages of 24 is far more than the
 * gallery has ever held, but an unbounded loop over somebody else's server is not
 * something to ship. Hitting it is reported rather than hidden.
 */
export const MAX_SCAN_PAGES = 20;

/** One page of the gallery as the reader sees it, pin included. */
export interface BrowseResult {
  items: HubItem[];
  /** Items in the whole set the reader is paging through. */
  total: number;
  page: number;
  lastPage: number;
  /**
   * The hub had more than {@link MAX_SCAN_PAGES} pages, so some went unread and
   * this many items is all that was checked against the pin.
   */
  truncated: { scanned: number } | null;
}

/** A game-name predicate, as `getGameMatcher()` hands one out. */
export type GameMatcher = (name: string) => boolean;

/**
 * Does this item belong in a pinned list? An item with no game at all is kept.
 * Some kinds carry no game name, and the point of a pin is to narrow to one game
 * rather than to hide everything that isn't tied to a game - a preset that works
 * anywhere works here too.
 */
export function matchesPinnedGame(
  gameName: string | null | undefined,
  matcher: GameMatcher | null,
): boolean {
  if (!matcher) return true;
  const name = gameName?.trim();
  if (!name) return true;
  return matcher(name);
}

/**
 * What to call the pinned game on screen, or null when the profile only gave a
 * regex. A regex is not something to show a player, so the caller says "one game"
 * instead of showing them `^Splinter *Faction`.
 */
export function describePinnedGame(filter?: GameFilter): string | null {
  const names = (filter?.names ?? []).map((n) => n.trim()).filter(Boolean);
  return names.length > 0 ? names.join(" or ") : null;
}

/** Pages needed to hold `total` items, at least one. */
function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, size)));
}

/**
 * Load the page of the gallery the browse screen should draw. Never throws: every
 * failure comes back as a sentence, the same way `./api` hands them out.
 */
export async function loadBrowsePage(
  base: string,
  filters: HubFilters,
  matcher: GameMatcher | null,
  signal?: AbortSignal,
): Promise<HubResult<BrowseResult>> {
  const wanted = Math.max(1, filters.page ?? 1);

  if (!matcher) {
    const result = await fetchHubItems(base, filters, signal);
    if (!result.ok) return result;
    const { items, total, pageSize } = result.value;
    return {
      ok: true,
      value: {
        items,
        total,
        page: wanted,
        lastPage: pageCount(total, pageSize),
        truncated: null,
      },
    };
  }

  // The first page says how big the whole set is, so the rest can be asked for
  // at once rather than one after another.
  const first = await fetchHubItems(base, { ...filters, page: 1 }, signal);
  if (!first.ok) return first;
  const size = Math.max(1, first.value.pageSize || first.value.items.length);
  const serverPages = pageCount(first.value.total, size);
  const reading = Math.min(serverPages, MAX_SCAN_PAGES);

  const rest = await Promise.all(
    Array.from({ length: reading - 1 }, (_, i) =>
      fetchHubItems(base, { ...filters, page: i + 2 }, signal),
    ),
  );
  const failed = rest.find((r) => !r.ok);
  if (failed && !failed.ok) return failed;

  const all = [
    ...first.value.items,
    ...rest.flatMap((r) => (r.ok ? r.value.items : [])),
  ];
  const kept = all.filter((item) => matchesPinnedGame(item.game_name, matcher));
  const lastPage = pageCount(kept.length, size);
  const page = Math.min(wanted, lastPage);
  return {
    ok: true,
    value: {
      items: kept.slice((page - 1) * size, page * size),
      total: kept.length,
      page,
      lastPage,
      truncated: serverPages > reading ? { scanned: all.length } : null,
    },
  };
}
