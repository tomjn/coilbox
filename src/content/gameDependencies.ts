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

/**
 * What a launch says when a game's dependency archive is not installed (issue
 * #3489). One sentence pair for every place that stops a launch on it.
 */
export function dependencyBlockReason(archive: string, gameName: string) {
  return `Archive not installed: ${archive}. ${gameName} depends on it.`;
}
