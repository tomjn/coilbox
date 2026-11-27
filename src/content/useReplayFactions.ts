import { useMemo } from "react";
import type { DemoInfo } from "./bindings";
import {
  useScanTargetSelection,
  useUnitsyncGameInfo,
  useUnitsyncScan,
} from "./config";
import { closestInstalledGame, recordedGame } from "./replayBuildOrders";
import { needsUnitList, withPickedSides } from "./replayFactions";
import { useReplayUnits } from "./useReplayUnits";

/** Stands in while there is no replay, so the hooks below are always called. */
const NO_REPLAY = { gameType: "", remixed: false };

const NO_SIDES: never[] = [];

/**
 * The side data of the game a replay was played on, or none until it is read.
 * Every version of a game spells its sides and start units the same way, so a
 * version that is not the recorded one still names them. Reads nothing of a
 * game while `wanted` is false.
 */
export function useRecordedGameSides(
  info: Pick<DemoInfo, "gameType" | "remixed" | "sourceGametype">,
  wanted: boolean,
) {
  const { selected } = useScanTargetSelection();
  const scan = useUnitsyncScan(selected?.enginePath, selected?.rootPath);
  const game =
    wanted && scan.data
      ? closestInstalledGame(recordedGame(info), scan.data.games)
      : null;
  const read = useUnitsyncGameInfo(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );
  return {
    sides: read.info?.sides ?? NO_SIDES,
    status: read.status,
    /** Whether a version of the game is installed to read them from. */
    installed: game !== null,
    scanned: !!scan.data,
    scanning: scan.loading,
  };
}

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
  const byUnit = info?.players.some((p) => needsUnitList(p.pick)) ?? false;
  const sides = useRecordedGameSides(info ?? NO_REPLAY, picked);
  const read = useReplayUnits(info ?? NO_REPLAY, byUnit, "stream");
  // Another version's list numbers its units differently.
  const units =
    read.source?.kind === "installed" || read.source?.kind === "stored"
      ? read.units
      : null;
  // A stored list is built afresh on every render, so the answer is keyed on
  // the names it gives and not on the list.
  const players = info
    ? withPickedSides(info.players, units, sides.sides)
    : null;
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
    sides.scanned &&
    (read.source === null || read.status === "loading");
  const pending =
    picked && (sides.scanning || sides.status === "loading" || readingUnits);
  return { info: named, pending };
}
