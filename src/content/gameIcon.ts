import { createGameResolver } from "../career/games";
import { compareGameVersions } from "../play/installedGames";
import type { GameItem } from "./bindings";
import { resolveBranding, type useBrandingCatalog } from "./branding";

type Entries = ReturnType<typeof useBrandingCatalog>;

/** Where a game's icon comes from. Every field is optional: none is a miss. */
export interface GameIconArt {
  /** The branding catalog's logo URLs, tried in order. */
  logo?: string[];
  /** The branding catalog's banner URLs, tried in order. */
  banner?: string[];
  /** The installed game whose own loading-screen art is the last resort. */
  headerGame?: string;
}

/**
 * The key two names share when they are one game at different versions, from
 * the same resolver the Career page groups by. A game's archive name (a
 * replay's `gameType`) and its title (a Career card) both land on it. Empty for
 * a blank name.
 */
export function gameIconKey(
  name: string,
  installed: readonly GameItem[] | null,
): string {
  if (!name.trim()) return "";
  return createGameResolver(installed).byName(name).key;
}

/** The newest installed version of the game a name refers to, if installed. */
function installedGameFor(
  name: string,
  installed: readonly GameItem[] | null,
): GameItem | undefined {
  if (!installed || !name.trim()) return undefined;
  const resolver = createGameResolver(installed);
  const id = resolver.byName(name);
  if (!id.installed) return undefined;
  let newest: GameItem | undefined;
  for (const g of installed) {
    if (resolver.byName(g.name).key !== id.key) continue;
    if (
      !newest ||
      compareGameVersions(g.info.version ?? "", newest.info.version ?? "") > 0
    ) {
      newest = g;
    }
  }
  return newest;
}

/**
 * Where the icon for the game a name refers to comes from. The branding
 * catalog's art goes first, as on the Games page. A game's own loading-screen
 * art is the fallback, and only an installed game has one. A game that is not
 * installed can still match the catalog by name.
 */
export function gameIconArt(
  name: string,
  installed: readonly GameItem[] | null,
  entries: Entries,
): GameIconArt {
  if (!name.trim()) return {};
  const game = installedGameFor(name, installed);
  const entry = resolveBranding(
    entries,
    game ?? { name: name.trim(), info: {} },
  );
  const art: GameIconArt = {};
  if (entry?.logo?.length) art.logo = entry.logo;
  if (entry?.banner?.length) art.banner = entry.banner;
  if (game) art.headerGame = game.name;
  return art;
}
