import { useEffect, useMemo, useState } from "react";
import { buildHeatField, type HeatField } from "@/lib/heatField";
import type { DemoInfo } from "./bindings";
import { analysisRunHidden, useStoredAnalyses } from "./replayAnalysis";
import type { LogEvent } from "./replayAnalysisEvents";
import {
  costedDeaths,
  DEATH_KINDS,
  deathPoints,
  type EventState,
  eventBlock,
  eventState,
  FINISHED_KINDS,
  type FinishedBuildings,
  type FinishedMark,
  finishedBuildings,
  placedEvents,
} from "./replayEventLayers";
import { readReplayEvents } from "./replayEventRead";
import type { MapWorld } from "./replayMapLayers";
import {
  START_UNIT_KINDS,
  START_UNIT_LOGGER_VERSION,
  startUnitEnds,
  startUnitTracks,
  trackInRange,
} from "./replayStartUnits";
import {
  countInRange,
  filterByFrame,
  type TimeWindow,
  windowPoints,
  windowRange,
} from "./replayTimeWindow";
import { useReplayUnits } from "./useReplayUnits";

type ReadStatus = "idle" | "loading" | "failed" | "done";

/** One read of some kinds of an analysis's events, made while `wanted`. */
function useEventRead(
  state: EventState,
  kinds: readonly string[],
  wanted: boolean,
): { status: ReadStatus; events: LogEvent[] } {
  const gameId = state.kind === "ready" ? state.gameId : null;
  const atMs = state.kind === "ready" ? state.analysedAtMs : 0;
  const key = wanted && gameId ? `${gameId}\n${atMs}\n${kinds.join()}` : null;
  const [read, setRead] = useState<{
    key: string;
    status: "failed" | "done";
    events: LogEvent[];
  } | null>(null);
  useEffect(() => {
    if (!key || !gameId) return;
    let stale = false;
    readReplayEvents(gameId, atMs, kinds).then(
      (events) => {
        if (!stale) setRead({ key, status: "done", events });
      },
      () => {
        if (!stale) setRead({ key, status: "failed", events: [] });
      },
    );
    return () => {
      stale = true;
    };
  }, [key, gameId, atMs, kinds]);
  if (!key) return { status: "idle", events: [] };
  if (read?.key !== key) return { status: "loading", events: [] };
  return { status: read.status, events: read.events };
}

export interface EventLayerCount {
  noun: string;
  inside: number;
  total: number;
}

export type EventLayers = ReturnType<typeof useReplayEventLayers>;

/**
 * The replay map's layers drawn from the analysis's event log (#1160): where
 * units died, where buildings were finished, and where each team's starting
 * units went and ended.
 *
 * Nothing is read until a layer is on and the replay has an analysis that
 * can be read, and then only the kinds that layer draws. The time window is
 * applied here, so the field and the marks it hands back are the window's own.
 * `toggles` is what the reader chose, and a layer is `on` only when the replay
 * has events to draw it from.
 */
export function useReplayEventLayers({
  info,
  layersShown,
  toggles,
  world,
  sized,
  timeWindow,
  domainSec,
}: {
  info: DemoInfo;
  layersShown: boolean;
  toggles: {
    deaths: boolean;
    finished: boolean;
    startUnitDeaths: boolean;
    startUnitPaths: boolean;
  };
  world: MapWorld;
  sized: boolean;
  timeWindow: TimeWindow | null;
  domainSec: number;
}) {
  const analyses = useStoredAnalyses();
  const stored =
    info.remixed || !info.gameId ? undefined : analyses.get(info.gameId);
  const state = eventState(info, stored, analysisRunHidden());
  const block = layersShown ? eventBlock(state) : null;
  const ready = layersShown && state.kind === "ready";
  const deathsOn = ready && toggles.deaths;
  const finishedOn = ready && toggles.finished;
  const startDeathsOn = ready && toggles.startUnitDeaths;
  const startPathsOn = ready && toggles.startUnitPaths;
  const startOn = startDeathsOn || startPathsOn;

  const deathRead = useEventRead(state, DEATH_KINDS, deathsOn);
  const finishedRead = useEventRead(state, FINISHED_KINDS, finishedOn);
  const startRead = useEventRead(state, START_UNIT_KINDS, startOn);
  const units = useReplayUnits(info, deathsOn || finishedOn, "events");

  const [costMode, setCostMode] = useState(false);
  const deaths = useMemo(
    () => placedEvents(deathRead.events, "unit_destroyed"),
    [deathRead.events],
  );
  const costed = useMemo(
    () => costedDeaths(deaths, units.units),
    [deaths, units.units],
  );
  const canWeigh = costed > 0;
  const weighted = costMode && canWeigh;

  const points = useMemo(
    () => deathPoints(deaths, weighted ? units.units : null),
    [deaths, weighted, units.units],
  );
  const range = useMemo(
    () => windowRange(timeWindow, domainSec),
    [timeWindow, domainSec],
  );
  const deathsInWindow = useMemo(
    () => countInRange(points.frames, range),
    [points, range],
  );
  const field: HeatField | null = useMemo(
    () =>
      deathsOn && sized && deathsInWindow > 0
        ? buildHeatField(
            windowPoints(points.points, points.frames, range),
            world,
          )
        : null,
    [deathsOn, sized, deathsInWindow, points, range, world],
  );

  const finishedAll: FinishedBuildings | null = useMemo(
    () =>
      finishedOn && sized && units.units
        ? finishedBuildings(
            placedEvents(finishedRead.events, "unit_finished"),
            world,
            units.units,
          )
        : null,
    [finishedOn, sized, finishedRead.events, world, units.units],
  );
  const finishedMarks: readonly FinishedMark[] | null = useMemo(
    () => (finishedAll ? filterByFrame(finishedAll.marks, range) : null),
    [finishedAll, range],
  );

  // An analysis from before the logger flagged starting units holds none, which
  // is a different answer from a match that had none.
  const startUnitsRecorded =
    state.kind === "ready" && state.loggerVersion >= START_UNIT_LOGGER_VERSION;
  const tracks = useMemo(
    () => startUnitTracks(startRead.events),
    [startRead.events],
  );
  const startEndsAll = useMemo(() => startUnitEnds(tracks), [tracks]);
  const startEnds = useMemo(
    () => (startDeathsOn ? filterByFrame(startEndsAll, range) : []),
    [startDeathsOn, startEndsAll, range],
  );
  const startPaths = useMemo(
    () =>
      startPathsOn
        ? tracks
            .map((track) => ({ track, points: trackInRange(track, range) }))
            .filter((path) => path.points.length > 0)
        : [],
    [startPathsOn, tracks, range],
  );

  // What the time window counts for these layers, each in its own noun.
  const counts: EventLayerCount[] = [];
  if (deathsOn && deathRead.status === "done")
    counts.push({
      noun: "deaths",
      inside: deathsInWindow,
      total: deaths.length,
    });
  if (finishedAll && finishedMarks)
    counts.push({
      noun: "finished buildings",
      inside: finishedMarks.length,
      total: finishedAll.marks.length,
    });

  if (startDeathsOn && startRead.status === "done" && startUnitsRecorded)
    counts.push({
      noun: "starting units lost",
      inside: startEnds.length,
      total: startEndsAll.length,
    });

  return {
    state,
    /** Why the layers cannot be turned on, or null. */
    block,
    deathsOn,
    finishedOn,
    startDeathsOn,
    startPathsOn,
    startRead,
    /** Whether the analysis is from a logger that flags starting units. */
    startUnitsRecorded,
    /** Every starting unit in the log, whatever the window. */
    tracks,
    /** The starting units that ended inside the window. */
    startEnds,
    /** Each starting unit's path inside the window. */
    startPaths,
    /** Whether any layer is drawing, which is when the window applies. */
    active: deathsOn || finishedOn || startOn,
    deathRead,
    finishedRead,
    units,
    deaths,
    deathsInWindow,
    /** Deaths whose unit the installed game states a metal cost for. */
    costed,
    canWeigh,
    weighted,
    setCostMode,
    field,
    finishedAll,
    finishedMarks,
    counts,
    windowed: timeWindow !== null,
  };
}
