import { useMemo } from "react";
import type { WorldExtent } from "@/startbox/polygon";
import { useZerokStartBoxes } from "@/startbox/useZerokStartBoxes";
import type { DemoInfo } from "./bindings";
import { useScanTargetSelection, useUnitsyncScan } from "./config";
import { closestInstalledGame, recordedGame } from "./replayBuildOrders";
import {
  rectangleAreas,
  replayRoom,
  type StartAreaSet,
  zerokAreas,
} from "./replayStartAreas";

/**
 * The start areas a replay's map draws (#5313), for either map mode.
 *
 * A Zero-K replay carries no rectangles, because Zero-K reads its areas from a
 * file in the game or the map. When the replay's game is installed and is
 * Zero-K, that file is run for the replay's own sides and players, and the areas
 * it gives are drawn as polygons. When there is no such file, or the game is
 * not Zero-K, or is not installed, the replay's own rectangles are what is
 * drawn, as they always were. A replay of another game never asks for the file.
 *
 * `extent` is the map's size in world units, which the file's script reads and
 * which places its points. Without it nothing is asked. The answer is kept for
 * the session by {@link useZerokStartBoxes}, as the battle room's is.
 *
 * `loading` is true while a file is being run, so a caller can hold back its
 * "no start boxes" line until the answer is in.
 */
export function useReplayStartAreas({
  info,
  extent,
}: {
  info: DemoInfo;
  extent: WorldExtent | null;
}): StartAreaSet & { loading: boolean } {
  const { selected } = useScanTargetSelection();
  const scan = useUnitsyncScan(selected?.enginePath, selected?.rootPath);
  const game = scan.data
    ? closestInstalledGame(recordedGame(info), scan.data.games)
    : null;
  const room = useMemo(() => replayRoom(info), [info]);
  const { config, loading } = useZerokStartBoxes({
    enginePath: selected?.enginePath,
    dataDir: selected?.rootPath,
    game,
    mapName: info.mapName || undefined,
    extent,
    room,
  });
  return useMemo(() => {
    if (config && extent)
      return { ...zerokAreas(config, info, extent), loading };
    return { ...rectangleAreas(info), loading };
  }, [config, extent, info, loading]);
}
