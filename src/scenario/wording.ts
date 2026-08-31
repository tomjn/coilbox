/**
 * What coilbox says about a scenario it cannot play, in words the reader in
 * front of it can act on (issue #862).
 *
 * The same facts reach two readers. An **author** has the editor open, so
 * "install it, or set the scenario up on a game you have" is two real choices,
 * and knowing which route a launch takes is the difference between testing the
 * mission and testing the generated game around it. A **player** on the
 * Scenarios page has a file someone sent them and often no editor at all, so
 * the second choice is an instruction they cannot follow, and coilbox's own
 * plumbing (the test mutator, mission runtime versions) is not theirs to know
 * about. All a player can act on is "install that game" and "update coilbox".
 *
 * One module, parameterised by reader, rather than two sets of sentences that
 * drift apart. Everything here is a plain string, so it is testable and there
 * is one place to read every refusal coilbox makes about a scenario.
 */

/** Who is being told. */
export type ScenarioReader = "author" | "player";

/**
 * A game the scenario is set in that this machine does not have.
 *
 * Shared by the pre-launch blocker and the launch's own refusal, so the answer
 * is the same wherever it is read. An empty `gameName` is a document that never
 * named one, which only an author can be looking at.
 */
export function gameNotInstalled(
  reader: ScenarioReader,
  gameName: string,
): string {
  const missing = gameName
    ? `${gameName} is not installed.`
    : "The game this scenario is set in is not installed.";
  return reader === "player"
    ? `${missing} Install it from Content to play this scenario.`
    : `${missing} Install it from Content, or set the scenario up on a game you have.`;
}

/**
 * What a player is told about every route that is not the game's own. Which of
 * the three it is, and why, is the author's business: a player needs to know
 * that it plays and that their copy of the game is left as it was.
 */
function coilboxSetsItUp(gameName: string): string {
  return `${gameName} cannot play a scenario on its own, so coilbox sets up what it needs. Your copy of ${gameName} is not changed.`;
}

/**
 * A packaged `.sd7`/`.sdz` game, which cannot be written into at all.
 *
 * Also what a packaged game's own page in Content says, through
 * {@link mutatorOffer}, so the game's page and the launch agree.
 */
export function packagedGameRoute(
  reader: ScenarioReader,
  gameName: string,
): string {
  return reader === "player"
    ? coilboxSetsItUp(gameName)
    : `${gameName} is a packaged archive, which cannot be written into. The scenario is played through coilbox's test mutator instead.`;
}

/** A loose game whose archive does not bundle the mission runtime. */
export function unadoptedGameRoute(
  reader: ScenarioReader,
  gameName: string,
): string {
  return reader === "player"
    ? coilboxSetsItUp(gameName)
    : `${gameName} has not adopted coilbox's mission runtime, so it cannot play a scenario itself. The scenario is played through the test mutator instead.`;
}

/** A game whose bundled runtime is older than the scenario needs. */
export function olderRuntimeRoute(
  reader: ScenarioReader,
  gameName: string,
  installed: number,
  required: number,
): string {
  return reader === "player"
    ? coilboxSetsItUp(gameName)
    : `${gameName} bundles mission runtime version ${installed}, and this scenario needs version ${required}. The scenario is played through the test mutator instead.`;
}

/** A game that bundles a runtime new enough to play the scenario itself. */
export function adoptedGameRoute(
  reader: ScenarioReader,
  gameName: string,
  installed: number,
): string {
  return reader === "player"
    ? `${gameName} plays this scenario itself.`
    : `${gameName} bundles mission runtime version ${installed}, so it plays the scenario itself.`;
}

/**
 * A game playing a mission out of its own archive, which needs no write from
 * coilbox at all.
 */
export function gameOwnMissionRoute(
  reader: ScenarioReader,
  gameName: string,
): string {
  return reader === "player"
    ? `This mission comes with ${gameName}, which plays it itself.`
    : `${gameName} ships this mission in its own archive, so it plays it itself and coilbox writes nothing.`;
}

/**
 * A packaged game whose shipped mission no longer matches the document beside
 * it. Only an author hears this, because a player cannot rebuild somebody
 * else's game.
 */
export function missionDriftedFromDocument(
  reader: ScenarioReader,
  gameName: string,
): string {
  return reader === "player"
    ? ""
    : `The mission ${gameName} ships does not match the document beside it. The shipped mission is what played.`;
}

/**
 * A scenario written against a runtime newer than this build of coilbox ships.
 * Both readers do the same thing about it, and neither can do it from here, so
 * only the framing changes.
 */
export function coilboxTooOld(
  reader: ScenarioReader,
  required: number,
  shipped: number,
): string {
  return reader === "player"
    ? "This scenario was made for a newer version of coilbox. Update coilbox to play it."
    : `This scenario needs mission runtime version ${required}, and this build of coilbox ships version ${shipped}. Update coilbox to play it.`;
}

/** The generated game coilbox just wrote, which the engine did not then find. */
export function setupNotFound(
  reader: ScenarioReader,
  gameName: string,
): string {
  return reader === "player"
    ? `Coilbox could not set this scenario up to play. Check that ${gameName} is still installed.`
    : `The engine did not pick up coilbox's test mutator. Check that ${gameName} is still installed.`;
}

/**
 * The lead-in to a refusal that came out of the read-back validator: how much
 * is wrong, and that nothing was played.
 *
 * The problems themselves are written in editor terms whichever reader sees
 * them, because they are the scenario's own faults. What a player can do about
 * one is go back to whoever shared it, so that is what this says.
 */
export function missionProblems(reader: ScenarioReader, count: number): string {
  const problems = `${count} problem${count === 1 ? "" : "s"}`;
  return reader === "player"
    ? `This scenario has ${problems}, so it did not start. Whoever made it has to fix it.`
    : `The compiled mission has ${problems}, so it was not launched.`;
}

/**
 * The lead-in to what validated as a warning: the mission played, and something
 * in it will read as a bug. Said after the launch, because it is not a reason to
 * refuse one.
 */
export function missionWarnings(reader: ScenarioReader, count: number): string {
  const things = count === 1 ? "one thing" : `${count} things`;
  return reader === "player"
    ? `It played, but ${things} in it looked wrong. Worth telling whoever shared it:`
    : `The mission played, but ${things} in it ${count === 1 ? "reads" : "read"} to a player as a bug:`;
}
