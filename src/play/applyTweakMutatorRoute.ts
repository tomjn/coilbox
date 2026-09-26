/**
 * Apply a project to a game with no tweak slots, by writing the mutator
 * archive and letting the caller play it instead (issue #3122's mutator
 * route, alongside `PresetTweaksView`'s tweak-slot route).
 *
 * A value the game's own Lua would turn into something else is written as one
 * it turns into the typed number first, checked by loading the game with
 * these very files, the same check `PlayLocallyButton`'s mutator route runs
 * before its own test launch (issue #3059). A failed settle is not a stop:
 * the mutator carries the typed values instead and the reason comes back for
 * the caller to show.
 *
 * Pulled out of `SkirmishPage` so this settle-then-write flow can be tested
 * on its own rather than through the whole page.
 */
import { primeScan } from "@/content/config";
import { isWorkshopMutatorArchive } from "@/lib/generatedGames";
import { settledSummary, settleTypedValues } from "@/workshop/loadsAs";
import { workshopTestMutator } from "@/workshop/mutator";
import type { ModProject } from "@/workshop/project";

export interface AppliedTweakMutator {
  /** The generated game's own name, for the caller to select. */
  gameType: string;
  /** The generated game's primary archive, for the caller's own mod-options
   *  reset guard (`prevArchive` in `SkirmishPage`). */
  archiveName: string;
  /** What the settle did, or why it could not run, or `null` when every typed
   *  value already loads as typed. */
  typedNote: string | null;
}

export async function applyTweakMutatorRoute({
  target,
  gameArchive,
  gameName,
  project,
}: {
  target: { enginePath: string; dataDir: string };
  /** The current game's primary archive, as unitsync names it, or
   *  `undefined` when it is not resolved yet. */
  gameArchive: string | undefined;
  gameName: string;
  project: ModProject;
}): Promise<AppliedTweakMutator> {
  const settled = gameArchive
    ? await settleTypedValues({
        enginePath: target.enginePath,
        dataDir: target.dataDir,
        archive: gameArchive,
        project,
      })
    : ({
        ok: false,
        message: `${gameName} is not installed here, so typed values are written as typed and the game may load some of them as something else.`,
      } as const);
  const written = await workshopTestMutator({
    dataDir: target.dataDir,
    project,
    written: settled.ok ? settled.settled.written : undefined,
  });
  const rescanned = await primeScan(target.enginePath, target.dataDir, true);
  const found = rescanned.games.find((g) =>
    isWorkshopMutatorArchive(g.primaryArchive.name),
  );
  if (!found)
    throw new Error(
      `Wrote the archive to ${written.dir} but the rescan did not find it.`,
    );
  return {
    gameType: found.name,
    archiveName: found.primaryArchive.name,
    typedNote: settled.ok ? settledSummary(settled.settled) : settled.message,
  };
}
