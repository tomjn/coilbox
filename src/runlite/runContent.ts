import type { GameDownload } from "../play/gameOffer";

/**
 * What the run page says about the run's game when it opens (issue #3369).
 *
 * Pure, so the decision is tested without React. A map is not decided here:
 * each battle's briefing checks its own map through `useBattleRun`.
 */

export interface RunGameReadings {
  /** An installed engine is available to scan with. */
  hasTarget: boolean;
  /** The installed engines have not been read yet. */
  targetLoading: boolean;
  /** A scan result has landed for that engine. */
  scanned: boolean;
  /** Diagnostics unitsync reported during the scan. */
  scanErrors: readonly string[];
  /** The scan lists a game the run's shortname resolves to. */
  gameInstalled: boolean;
  /** What a download can be named for the run's game, or null. */
  download: GameDownload | null;
}

export type RunGameNotice =
  /** Nothing to say: the game is installed, or something is still loading. */
  | { kind: "none" }
  /** No engine, so nothing can read what is installed. Offer an engine. */
  | { kind: "no-engine" }
  /** The scan could not read the games, so "missing" would be a guess. */
  | { kind: "unreadable" }
  /** The game is missing and this download fetches it. */
  | { kind: "download"; download: GameDownload }
  /** The game is missing and coilbox knows no download for it. */
  | { kind: "unavailable" };

export function runGameNotice(r: RunGameReadings): RunGameNotice {
  if (r.targetLoading) return { kind: "none" };
  if (!r.hasTarget) return { kind: "no-engine" };
  if (!r.scanned || r.gameInstalled) return { kind: "none" };
  if (r.scanErrors.length > 0) return { kind: "unreadable" };
  return r.download
    ? { kind: "download", download: r.download }
    : { kind: "unavailable" };
}
