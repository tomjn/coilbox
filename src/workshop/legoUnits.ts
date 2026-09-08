/**
 * A unit built in the lego builder, seen from the workshop (issue #2651).
 *
 * Export drops a `.s3o`, a script and a `units/<name>.lua` into a game folder
 * and until now that was the end of it: the definition it wrote never lists the
 * unit on anybody's build menu, so nothing in the game could build it (#663).
 * The missing half was never the file. It was that no part of coilbox looked at
 * a game folder afterwards and said what was now in it.
 *
 * So this is a read, not an import. Nothing is copied anywhere and there is no
 * button to press. The join is the folder: a lego export records where it went,
 * and a game's primary archive records where it is. A game that can receive an
 * export at all is a loose `.sdd` directory, since that is the only kind of
 * archive the export's folder picker can reach, so a game installed through
 * rapid never matches and never should.
 *
 * The surprise, found by exporting into a real game and looking: the game's own
 * unit table usually already has the unit. `units/<name>.lua` is a file in the
 * game, so the engine reads it like any other, and the workshop's own read of
 * the game comes back with it. So most of what this does is attribution. The
 * unit was already on the page and nothing said where it came from, and without
 * that a person cannot tell their own unit from the game's.
 *
 * A definition of our own is only put up where the game's read has none, which
 * happens because unitsync caches an archive and a new file inside a `.sdd` does
 * not always invalidate it. Then the receipt stands in until the read catches
 * up. Where the game does have the unit, the game's definition wins, and that is
 * the right way round: the export writes `units/<name>.lua` once and then leaves
 * it alone, so a hand edit to it is the truth about the game while the receipt
 * is a record of what was generated.
 *
 * Either way there is one unit per project, because a project has one current
 * export. Running the export again rewrites that receipt rather than adding a
 * second, so a re-export can never become a second unit.
 */
import { samePath } from "@/lego/exportRecord";
import type { LegoProject } from "@/lego/model";
import { type CloneOrigin, normaliseCloneKey, type UnitClones } from "./clones";

/** Stable empty, so a page with no built units does not re-render for one. */
const NONE: Record<string, CloneOrigin> = {};

/** Whether an export went into this game's folder. */
export function exportedInto(
  project: LegoProject,
  gameFolder: string | undefined,
): boolean {
  if (!gameFolder || !project.exported) return false;
  return samePath(project.exported.dir, gameFolder);
}

/** What a game folder was given, and what the page could not take. */
export interface LegoUnits {
  /**
   * The page's own copied units, plus a definition for any built unit the
   * game's read has not come back with.
   */
  clones: UnitClones;
  /**
   * Which units on this page came out of the lego builder, keyed by unit.
   *
   * Includes the names a project has stopped exporting under whose files a
   * rename left in the game, marked `stale` (issue #2680). Those are the whole
   * reason this is worth marking at all: the game reads them as ordinary units
   * and nothing else on the page can tell them from the one that was meant.
   */
  builtBy: Record<string, CloneOrigin>;
  /**
   * A built unit whose name something else on the page already holds, named by
   * the lego project it came from.
   *
   * A name the game itself uses is not a clash: that is the game reading the
   * exported file. What is left is a unit copied on this page, and a second
   * project exported under the same name. Neither is merged and neither is
   * silently dropped, because nothing here can tell which one the user meant.
   */
  conflicts: string[];
}

/**
 * Every unit built in the lego builder and exported into this game's folder,
 * put where the rest of the page can see it.
 */
export function withLegoUnits(
  clones: UnitClones,
  projects: LegoProject[],
  gameFolder: string | undefined,
  gameUnits: Record<string, unknown>,
): LegoUnits {
  const built = projects.filter((p) => exportedInto(p, gameFolder));
  const stale = gameFolder
    ? projects.flatMap((project) =>
        (project.staleExports ?? [])
          .filter((entry) => samePath(entry.dir, gameFolder))
          .map((entry) => ({ project, entry })),
      )
    : [];
  if (built.length === 0 && stale.length === 0)
    return { clones, conflicts: [], builtBy: NONE };

  let out = clones;
  const builtBy: Record<string, CloneOrigin> = {};
  const conflicts: string[] = [];
  for (const project of built) {
    const exported = project.exported;
    if (!exported) continue;
    const key = normaliseCloneKey(exported.unitName);
    if (!key) continue;
    // A unit copied here keeps the name, because it is live work in an unsaved
    // page and the export is a file that will still be there tomorrow. A second
    // project under one name is the other way this happens, and there the game
    // folder kept whichever definition reached it first, so the loser is not
    // the unit in the game either way.
    if (Object.hasOwn(clones, key) || Object.hasOwn(builtBy, key)) {
      conflicts.push(project.name);
      continue;
    }
    const origin: CloneOrigin = {
      kind: "lego",
      projectId: project.id,
      projectName: project.name,
    };
    builtBy[key] = origin;
    // Only where the game's read has nothing. Where it has the unit, that is
    // the engine reading the exported file, hand edits and all, and standing an
    // old receipt in front of it would show the wrong definition.
    if (!Object.hasOwn(gameUnits, key))
      out = {
        ...out,
        [key]: { key, origin, replacesGameUnit: false, def: exported.def },
      };
  }

  // The names a rename left behind (issue #2680). Marked only where the game's
  // own read has the unit, because that is the harm: the file is still there,
  // the engine loaded it, and the page shows a second unit nothing distinguishes
  // from the one that was meant. A stale unit the engine dropped, which is what
  // happens when the model was renamed too and its `objectname` no longer
  // resolves, is not in the game's table and there is nothing here to mark.
  //
  // No definition is put up for one, unlike a current export. There is nothing
  // to show that is not already the game's own table, and standing a receipt in
  // front of a unit somebody is about to delete would only describe it wrongly.
  for (const { project, entry } of stale) {
    const key = normaliseCloneKey(entry.unitName);
    if (!key || Object.hasOwn(builtBy, key) || Object.hasOwn(out, key))
      continue;
    if (!Object.hasOwn(gameUnits, key)) continue;
    builtBy[key] = {
      kind: "lego",
      projectId: project.id,
      projectName: project.name,
      stale: true,
    };
  }

  return { clones: out, conflicts, builtBy };
}
