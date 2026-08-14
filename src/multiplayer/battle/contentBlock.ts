/**
 * Why a player in a battle room cannot launch, named.
 *
 * A room is a projection of what the host says, so a joiner can sit in one for
 * ten minutes holding neither the map nor the game and find out only when the
 * match starts without them. That matters most on a direct room, where there is
 * no server to serve content and no hashes in the LAN beacon to warn before the
 * join. The battle itself does carry the map and game names, so the room can say
 * what is missing from the moment the joiner arrives.
 *
 * Pure, so it can be stated once and used in three places: the room banner, the
 * sync pill, and the launch itself.
 */

export interface LaunchContent {
  /** An engine and data dir are resolved, and that resolution has settled. */
  hasTarget: boolean;
  targetLoading: boolean;
  /**
   * The content scan has settled, so a missing verdict is a fact rather than a
   * list that has not loaded yet. A false verdict mid-scan reads as "you do not
   * have this game" for a game that is installed.
   */
  contentKnown: boolean;
  mapMissing: boolean;
  gameMissing: boolean;
  /** The battle's map name, as the host named it. */
  mapName: string;
  /** The battle's game name, as the host named it. */
  gameName: string;
}

export interface LaunchBlock {
  /** A few words, for the sync pill. */
  short: string;
  /** A sentence naming what is missing and what to do. */
  reason: string;
}

/**
 * What stops this player launching, or null when nothing does.
 *
 * Only settled facts block. While the engine target or the content scan is still
 * resolving there is no verdict to give, so it returns null and the caller waits.
 */
export function launchBlock(c: LaunchContent): LaunchBlock | null {
  if (!c.hasTarget) {
    if (c.targetLoading) return null;
    return {
      short: "No engine",
      reason:
        "No engine is selected, so this battle cannot start. Add a content folder with an engine in Settings, Content folders.",
    };
  }
  if (!c.contentKnown) return null;
  const map = c.mapName || "the map";
  const game = c.gameName || "the game";
  if (c.mapMissing && c.gameMissing) {
    return {
      short: "Map and game missing",
      reason: `You do not have the game (${game}) or the map (${map}) this battle uses, so it cannot start for you. Install both to play.`,
    };
  }
  if (c.gameMissing) {
    return {
      short: "Game missing",
      reason: `You do not have the game this battle uses (${game}), so it cannot start for you. Install it to play.`,
    };
  }
  if (c.mapMissing) {
    return {
      short: "Map missing",
      reason: `You do not have the map this battle uses (${map}), so it cannot start for you. Install it to play.`,
    };
  }
  return null;
}

/**
 * The same reason, worded for the moment the match is already running without
 * this player. Same fact, more urgent framing, because by then the room has
 * moved on and sitting still needs explaining.
 */
export function startedWithoutYou(block: LaunchBlock): string {
  return `The match has started without you. ${block.reason}`;
}
