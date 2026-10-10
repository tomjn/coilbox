import { useSetting } from "@picoframe/frame";
import { useMemo } from "react";
import { isProfileHidden } from "../profile/hidden";
import type { StatRecord } from "./bindings";
import { useStoredStatsRecords } from "./config";
import { refightFilenames, useReplayUserState } from "./replayUserState";
import { allPlayers, guessPrimaryPlayer } from "./stats";

/**
 * The primary player in a set of records: the one chosen in settings if they
 * appear, otherwise the one with the most games, or empty when there is none.
 * Split from the hook so a page that already holds the records can ask without
 * reading the store a second time.
 */
export function pickPrimaryPlayer(
  records: StatRecord[],
  refights: ReadonlySet<string>,
  stored: string,
): string {
  return (
    allPlayers(records, refights).find((p) => p.name === stored)?.name ??
    guessPrimaryPlayer(records, refights) ??
    ""
  );
}

/**
 * Who the library is about, as the dossier and the map and game pages decide it:
 * the player chosen in settings if they appear in the stats, otherwise the one
 * with the most games. Empty until the stats have loaded, and for ever when a
 * distribution profile hides statistics, since then nothing is ingested.
 *
 * It only reads the stored stats and never ingests, so opening a replay does not
 * walk the library or rewrite the stats file. On a library nothing has ingested
 * yet there is no one to find, until the stats page or the replay list has run.
 */
export function usePrimaryPlayer(): string {
  const statsHidden = isProfileHidden("multiplayer.stats");
  const records = useStoredStatsRecords(!statsHidden);
  const { state: replayUserState } = useReplayUserState();
  const refights = useMemo(
    () => refightFilenames(replayUserState),
    [replayUserState],
  );
  const [stored] = useSetting("content.statsPlayer", "");
  return useMemo(
    () => pickPrimaryPlayer(records, refights, stored),
    [records, refights, stored],
  );
}
