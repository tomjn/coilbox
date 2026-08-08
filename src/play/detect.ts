import type { DemoInfo, ReplayFile } from "../content/bindings";

/**
 * Pure pieces of automatic win/loss detection from a run's replay, kept apart
 * from the Tauri-calling orchestration so they're directly unit-testable (no
 * plugin commands to mock — see `detect.test.ts`). The campaign and conquest
 * run hooks compose these with `contentListReplays`/`contentDemoInfo` to build
 * the actual detection flow: snapshot replays before launch, diff after, pick
 * the newest, decode it, and read off the local player's result.
 */

export type DetectedResult = "victory" | "defeat" | "ambiguous";

/** The replays present in `after` that weren't in `before` (by path). */
export function diffNewReplays(
  before: ReadonlySet<string>,
  after: readonly ReplayFile[],
): ReplayFile[] {
  return after.filter((r) => !before.has(r.path));
}

/** The most recently written of a set of replays, or `null` when empty. */
export function pickNewestReplay(
  replays: readonly ReplayFile[],
): ReplayFile | null {
  if (replays.length === 0) return null;
  return replays.reduce((newest, r) =>
    r.modifiedMs > newest.modifiedMs ? r : newest,
  );
}

/**
 * The verdict for `playerName` from a decoded demo: victory/defeat when the
 * demo names a winner and the player's own (non-spectator) entry is found,
 * ambiguous otherwise (winner unknown, player missing, or spectating).
 */
export function resultFromDemoInfo(
  info: DemoInfo,
  playerName: string,
): DetectedResult {
  if (!info.winnersKnown) return "ambiguous";
  const player = info.players.find(
    (p) => p.name === playerName && p.spectator === false,
  );
  if (!player) return "ambiguous";
  if (player.won === true) return "victory";
  if (player.won === false) return "defeat";
  return "ambiguous";
}

/**
 * Whether a just-finished launch should be reported as an engine failure
 * instead of falling through to the manual result prompt. A nonzero exit
 * code and no newly-written replay together are a stronger signal than
 * either alone: the engine died before anything was recorded, so there is
 * nothing ambiguous to ask the player about. A nonzero exit code alongside a
 * fresh replay is left alone, since the engine can exit nonzero after a
 * completed game, and that replay is real evidence not to discard.
 */
export function engineFailureMessage(
  exitCode: number,
  replayFound: boolean,
): string | null {
  if (exitCode === 0 || replayFound) return null;
  return `Engine exited with code ${exitCode}.`;
}
