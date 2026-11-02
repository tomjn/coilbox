/**
 * Which installed game an imported tweak project opens against (issue #2965).
 *
 * A project names the exact build its author had, such as "Balanced Annihilation
 * V15.9.8". The editor looks a project's game up by that exact name, so on a
 * machine that has moved on to V15.9.9 the project opens to "not installed
 * here", and the comparison in `compatibility.ts` that says which edits no
 * longer apply never runs.
 *
 * So an import is pointed at the newest installed build of the same game before
 * it is saved. The author's checksum travels with it, which is what lets the
 * editor see that the game has moved and say what that did to the edits.
 */

import {
  gameIdentityForName,
  type InstalledGameInfo,
} from "../container/gameIdentity";
import { resolveGameByShortname } from "../play/installedGames";
import type { ImportedProject } from "./project";

/**
 * The project, opened against the installed game it was made for or, failing
 * that, the newest installed build of the same game.
 *
 * It comes back unchanged when its exact build is installed, when no installed
 * game shares its shortname, or when its shortname is not known. The editor then
 * says the game is not installed, which is true, and keeps the edits.
 */
export function bindToInstalledGame(
  imported: ImportedProject,
  installed: readonly InstalledGameInfo[],
): ImportedProject {
  if (installed.some((g) => g.name === imported.gameName)) return imported;
  const shortname =
    imported.game?.shortname ??
    gameIdentityForName(imported.gameName, installed)?.shortname;
  if (!shortname) return imported;
  const resolved = resolveGameByShortname(
    { shortname, pinnedName: imported.gameName },
    installed.map((g) => ({ name: g.name, info: g.info ?? {} })),
  );
  if (!resolved) return imported;
  return {
    ...imported,
    gameName: resolved.name,
    game: { name: resolved.name, shortname },
  };
}
