import { useMemo } from "react";
import type { DemoInfo } from "./bindings";
import { analysisRunHidden, useStoredAnalyses } from "./replayAnalysis";
import { spawnedStarts } from "./replayBaseCrops";
import { eventState } from "./replayEventLayers";
import { START_UNIT_KINDS, startUnitTracks } from "./replayStartUnits";
import { useEventRead } from "./useReplayEventLayers";

/**
 * Where each team's first starting unit appeared, when the replay has an
 * analysis, since a game can start a player somewhere other than the recorded
 * start (#5339, #5346). Both the base pictures and the map's start dots place a
 * start from this, so they agree.
 *
 * Nothing is read until `wanted` and the replay has an analysis that can be
 * read. `loading` is true while that read is out, so a caller can wait rather
 * than draw the recorded start and then jump.
 */
export function useSpawnedStarts(info: DemoInfo, wanted: boolean) {
  const analyses = useStoredAnalyses();
  const stored =
    info.remixed || !info.gameId ? undefined : analyses.get(info.gameId);
  const state = eventState(info, stored, analysisRunHidden());
  const read = useEventRead(
    state,
    START_UNIT_KINDS,
    wanted && state.kind === "ready",
  );
  const spawns = useMemo(
    () => spawnedStarts(startUnitTracks(read.events)),
    [read.events],
  );
  return { spawns, loading: read.status === "loading" };
}
