import { useMemo } from "react";
import type { DemoInfo } from "./bindings";
import {
  useScanTargetSelection,
  useUnitsyncGameInfo,
  useUnitsyncScan,
} from "./config";
import { closestInstalledGame, recordedGame } from "./replayBuildOrders";
import { withPickedSides } from "./replayFactions";
import { useReplayUnits } from "./useReplayUnits";

/** Stands in while there is no replay, so the hooks below are always called. */
const NO_REPLAY = { gameType: "", remixed: false };

const NO_SIDES: never[] = [];

/**
 * A decoded replay with the faction each player picked in the match in place of
 * the start script's `side` (#5489), for everything that shows or reuses a
 * side. `pending` is true while the names are still being read. Reads nothing
 * for a replay with no picks.
 */
export function useReplayFactions(info: DemoInfo | null): {
  info: DemoInfo | null;
  pending: boolean;
} {
  const picked = info?.players.some((p) => p.pick) ?? false;
  const byUnit =
    info?.players.some((p) => p.pick?.unitDefId !== undefined) ?? false;
  const { selected } = useScanTargetSelection();
  const scan = useUnitsyncScan(selected?.enginePath, selected?.rootPath);
  // Every version of a game spells its sides and start units the same way, so a
  // version that is not the recorded one still names them.
  const game =
    picked && scan.data
      ? closestInstalledGame(recordedGame(info ?? NO_REPLAY), scan.data.games)
      : null;
  const sides = useUnitsyncGameInfo(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );
  const read = useReplayUnits(info ?? NO_REPLAY, byUnit, "stream");
  // Another version's list numbers its units differently.
  const units =
    read.source?.kind === "installed" || read.source?.kind === "stored"
      ? read.units
      : null;
  const gameSides = sides.info?.sides ?? NO_SIDES;
  // A stored list is built afresh on every render, so the answer is keyed on
  // the names it gives and not on the list.
  const players = info ? withPickedSides(info.players, units, gameSides) : null;
  const changed = players !== null && players !== info?.players;
  const key = changed ? JSON.stringify(players.map((p) => p.side)) : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `players`
  const named = useMemo(
    () => (info && changed ? { ...info, players } : info),
    [info, key],
  );
  // No source with a scan in hand means the kept lists have not answered.
  const readingUnits =
    byUnit &&
    !!scan.data &&
    (read.source === null || read.status === "loading");
  const pending =
    picked && (scan.loading || sides.status === "loading" || readingUnits);
  return { info: named, pending };
}
