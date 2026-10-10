import { useSetting } from "@picoframe/frame";
import { useMemo } from "react";
import { isProfileHidden } from "../profile/hidden";
import {
  useContentState,
  useReplayStats,
  useScanTargetSelection,
} from "./config";
import { refightFilenames, useReplayUserState } from "./replayUserState";
import { allPlayers, guessPrimaryPlayer } from "./stats";

/**
 * Who the library is about, as the dossier and the map and game pages decide it:
 * the player chosen in settings if they appear in the stats, otherwise the one
 * with the most games. Empty until the stats have loaded, and for ever when a
 * distribution profile hides statistics, since then nothing is ingested.
 */
export function usePrimaryPlayer(): string {
  const statsHidden = isProfileHidden("multiplayer.stats");
  const { selected } = useScanTargetSelection();
  const { state: contentState } = useContentState();
  const roots = useMemo(
    () => (statsHidden ? [] : (contentState?.roots ?? []).map((r) => r.path)),
    [contentState, statsHidden],
  );
  const { records } = useReplayStats(roots, selected?.enginePath);
  const { state: replayUserState } = useReplayUserState();
  const refights = useMemo(
    () => refightFilenames(replayUserState),
    [replayUserState],
  );
  const [stored] = useSetting("content.statsPlayer", "");
  return useMemo(
    () =>
      allPlayers(records, refights).find((p) => p.name === stored)?.name ??
      guessPrimaryPlayer(records, refights) ??
      "",
    [records, refights, stored],
  );
}
