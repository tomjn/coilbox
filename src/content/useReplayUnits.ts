import type { DemoInfo } from "./bindings";
import {
  useScanTargetSelection,
  useUnitsyncScan,
  useUnitsyncUnitDataset,
} from "./config";
import { pickUnitSource, recordedGame } from "./replayBuildOrders";

/**
 * The installed game that can name a replay's unit ids, and its units (#1145).
 *
 * Shared by the build order section and the map layers (#1152), so both name a
 * unit from the same game and say the same thing when none is installed.
 * Nothing is asked of unitsync until `wanted` is true, which a caller sets
 * once it has orders to name.
 */
export function useReplayUnits(info: DemoInfo, wanted: boolean) {
  const { selected } = useScanTargetSelection();
  const scan = useUnitsyncScan(selected?.enginePath, selected?.rootPath);
  const recorded = recordedGame(info);
  const source =
    wanted && scan.data && !scan.loading
      ? pickUnitSource(recorded, scan.data.games)
      : null;
  const archive =
    source && source.kind !== "notInstalled"
      ? source.game.primaryArchive.name
      : undefined;
  const { dataset, status } = useUnitsyncUnitDataset(
    selected?.enginePath,
    selected?.rootPath,
    archive,
  );
  return {
    selected,
    recorded,
    source,
    archive,
    status,
    /** The game's units in id order, or null when they cannot be read. */
    units: archive && dataset ? dataset.units : null,
  };
}
