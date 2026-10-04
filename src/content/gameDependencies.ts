/**
 * What to tell the player about a game whose dependency archives are not all
 * installed (issue #3482). The scan names each one in `missingDependencies`,
 * lower-cased the way the engine reports it.
 */
export function missingDependencyNotes(game: {
  missingDependencies?: string[];
}): string[] {
  return (game.missingDependencies ?? []).map(
    (name) => `Depends on "${name}", which is not installed.`,
  );
}
