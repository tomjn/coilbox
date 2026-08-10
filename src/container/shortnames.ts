/**
 * Every modinfo shortname coilbox has read here, kept by archive name (issue
 * #1364).
 *
 * A shortname only exists in a game's modinfo, and coilbox only reads modinfo
 * out of an installed archive. So {@link gameIdentityForName} filled one in by
 * looking the exact archive name up in the live unitsync scan, and a container
 * pinned to a build that is no longer installed got no shortname at all.
 *
 * That is not the rare case it sounds like. A mod's installed archive moves to a
 * new exact name on every update and the old one goes, so a player who set a
 * skirmish up on 0.1.77 and then updated to 0.1.78 exports a preset with no
 * shortname, on the very machine that read that game's modinfo an hour ago.
 * Coilbox Hub groups items by shortname and cannot group on the archive name
 * (`SplinterFaction 0.1.78` would mint a fresh facet every release), so what is
 * lost there is the item's place in its game's gallery.
 *
 * A mod's shortname does not change between its own releases, so a shortname
 * read once for any build is still the right answer for a different build's
 * name later. Holding onto them costs two short strings per game build this
 * machine has ever had, and keeping the old ones is the entire point, so nothing
 * here is ever evicted.
 *
 * Only a modinfo coilbox itself read gets in. A container arriving from
 * elsewhere carries a shortname too, and it is not written here: it would let a
 * bad payload name a game this machine has never installed, and everything
 * coilbox exports afterwards for that name would repeat it.
 *
 * Two installs on one machine share `localStorage` while sharing no content
 * (issue #1115), and unlike the home page's card art this store wants that. An
 * archive's shortname belongs to the archive, not to the install that read it,
 * so either install answering for the other is right rather than a leak, and
 * nothing here prunes what it cannot currently see.
 */

import type { InstalledGameInfo } from "./gameIdentity";

/** Where the shortnames are kept, beside the notification history and the home
 * page's card art. */
const STORAGE_KEY = "coilbox.container.shortnames";

/** Read what earlier sessions learned. Guarded for a webview with storage off,
 * a node test environment, and text that is no longer JSON. */
function load(): Map<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== "object" || parsed === null) return new Map();
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    return new Map(entries);
  } catch {
    return new Map();
  }
}

let known = load();

function persist(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(known)),
    );
  } catch {
    // No storage. Everything still works for this session, it simply teaches
    // the next one nothing.
  }
}

/**
 * Hold onto the shortname of every game in a unitsync scan, so a later export
 * pinned to one of these builds still knows it after the build is gone.
 *
 * A fresh read wins over a held one for the same archive name: this is a record
 * of what the modinfo said, and the scan just said it.
 */
export function rememberShortnames(games: readonly InstalledGameInfo[]): void {
  let changed = false;
  for (const game of games) {
    const name = game.name?.trim();
    const shortname = game.info?.shortname?.trim();
    if (!name || !shortname) continue;
    if (known.get(name) === shortname) continue;
    known.set(name, shortname);
    changed = true;
  }
  if (changed) persist();
}

/** The shortname read for this exact archive name, whenever it was read. */
export function rememberedShortname(name: string): string | undefined {
  return known.get(name.trim());
}

/** Everything held, for tests and for anyone reporting on it. */
export function rememberedShortnames(): ReadonlyMap<string, string> {
  return known;
}

/** Forget the lot. For tests, which each want to start from nothing. */
export function resetShortnames(): void {
  known = new Map();
}

/** Start from what storage holds now, after a test has stubbed it. */
export function loadShortnames(): void {
  known = load();
}
