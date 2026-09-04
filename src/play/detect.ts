import {
  contentDemoInfo,
  contentListReplays,
  type DemoInfo,
  type ReplayFile,
} from "../content/bindings";
import type { PlayTarget } from "./config";

/**
 * Automatic win/loss detection from a run's replay. Most of this is pure,
 * kept apart from Tauri-calling orchestration so it's directly unit-testable
 * (see `detect.test.ts`). `findNewReplay` and `detectBattleResult` do call
 * `contentListReplays` and `contentDemoInfo`, and live here because the same
 * poll loop and retry constants used to be copied into all four callers
 * (campaign, conquest, runlite, and the skirmish provenance tagger). See
 * issue #2439.
 */

export type DetectedResult = "victory" | "defeat" | "ambiguous";

const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
 * Poll the content root for a replay that appeared after `beforePaths` was
 * snapshotted. A filesystem flush can lag briefly behind the engine exiting,
 * so an empty diff is retried a few times before giving up.
 */
export async function findNewReplay(
  dataDir: string,
  beforePaths: ReadonlySet<string>,
): Promise<ReplayFile | null> {
  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    const { replays } = await contentListReplays({ root: dataDir });
    const newest = pickNewestReplay(diffNewReplays(beforePaths, replays));
    if (newest) return newest;
    if (attempt < RETRY_COUNT) await sleep(RETRY_DELAY_MS);
  }
  return null;
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
 * Detect the outcome of a just-finished launch: find the replay that
 * appeared since `beforePaths` was snapshotted (pre-launch), decode it, and
 * read off `playerName`'s result. Any failure along the way (no new replay,
 * a decode error, an unknown winner, or the player not being in the demo)
 * resolves to `"ambiguous"` rather than throwing, so the caller always falls
 * back to the manual prompt.
 *
 * The replay itself (when found) is returned alongside the outcome so the
 * caller can tag it with provenance at exactly the moment its filename
 * becomes known.
 */
export async function detectBattleResult(opts: {
  target: PlayTarget;
  beforePaths: ReadonlySet<string>;
  playerName: string;
}): Promise<{ outcome: DetectedResult; replay: ReplayFile | null }> {
  const { target, beforePaths, playerName } = opts;
  try {
    const replay = await findNewReplay(target.dataDir, beforePaths);
    if (!replay) return { outcome: "ambiguous", replay: null };
    const { info } = await contentDemoInfo({
      enginePath: target.enginePath,
      replayPath: replay.path,
    });
    return { outcome: resultFromDemoInfo(info, playerName), replay };
  } catch {
    return { outcome: "ambiguous", replay: null };
  }
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
