/**
 * The games coilbox writes for itself.
 *
 * Two flows need a game the engine can launch that the player never installed.
 * The unit builder tests a built unit in one (`src/lego/scratchGame.ts`), and a
 * scenario is tested in one when the real game cannot play missions
 * (`src/scenario/mutator.ts`). Both are loose `.sdd` folders under the content
 * root's `games/`, so unitsync scans them and reports them as games like any
 * other, and every game list picks them up.
 *
 * That is the whole reason this module exists. Each flow already recognised its
 * own folder, and nothing recognised both, so a picker that filtered one still
 * offered the other. Both names, both predicates and the union of them live
 * here, and every list asks this one module.
 *
 * It imports nothing on purpose. `src/scenario/mutator.ts` reaches the plugin
 * through its bindings, so a picker that only wants to know a folder name should
 * not have to pull a Tauri command in behind it.
 */

/**
 * The unit builder's scratch archive. Fixed, so repeated tests reuse one folder
 * rather than leaving a trail of them, and so the Rust side can refuse any name
 * that is not this shape.
 */
export const SCRATCH_FOLDER = "coilbox-lego-test.sdd";

/**
 * The scenario test mutator's folder, matching the constant the plugin writes
 * to.
 */
export const MUTATOR_FOLDER = "coilbox-mission-test.sdd";

/** Whether a scanned archive is the unit builder's scratch game. */
export function isScratchArchive(archiveName: string): boolean {
  return archiveName.toLowerCase() === SCRATCH_FOLDER;
}

/** Whether a scanned archive is the scenario test mutator. */
export function isMutatorArchive(archiveName: string): boolean {
  return archiveName.toLowerCase() === MUTATOR_FOLDER;
}

const UNDO = "Deleting its folder undoes it.";

/**
 * What coilbox generated this archive for, in a sentence, or `null` for a game
 * the player installed.
 *
 * Both notes end the same way, because that is what a player most needs to
 * know: the folder is the whole of it, and removing the folder is the undo.
 */
export function generatedGameNote(archiveName: string): string | null {
  if (isScratchArchive(archiveName))
    return `Coilbox writes this game to test a unit from the builder in, and rewrites it on every test launch. It is not a game to play. ${UNDO}`;
  if (isMutatorArchive(archiveName))
    return `Coilbox writes this game to test a scenario in when the real game cannot play one, and rewrites it on every test launch. It is not a game to play. ${UNDO}`;
  return null;
}

/** Whether coilbox generated this archive rather than the player installing it. */
export function isGeneratedGame(archiveName: string): boolean {
  return generatedGameNote(archiveName) !== null;
}

/**
 * A scanned game list with coilbox's own generated games taken out, for the
 * pickers: choosing one for an ordinary match is never what a player meant.
 * Content > Games shows them instead, labelled, so a folder on disk that is
 * missing from every list is not a mystery.
 *
 * `keep` is the game the caller has already chosen, by the name unitsync
 * reports. It survives the filter, because a screen that resolves its selection
 * against this list would otherwise report a game sitting on disk as one the
 * machine does not have. Hiding what may be picked is the point. Hiding what
 * was picked is a lie.
 */
export function withoutGeneratedGames<
  T extends { name: string; primaryArchive: { name: string } },
>(games: readonly T[], keep?: string): T[] {
  return games.filter(
    (g) => g.name === keep || !isGeneratedGame(g.primaryArchive.name),
  );
}
