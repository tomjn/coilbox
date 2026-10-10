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
 * The replay map's two layers drawn from the analysis's event log (#1160):
 * where units died, and where buildings were finished.
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
  toggles: { deaths: boolean; finished: boolean };
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

  const deathRead = useEventRead(state, DEATH_KINDS, deathsOn);
  const finishedRead = useEventRead(state, FINISHED_KINDS, finishedOn);
  const units = useReplayUnits(info, deathsOn || finishedOn);

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

  return {
    state,
    /** Why the layers cannot be turned on, or null. */
    block,
    deathsOn,
    finishedOn,
    /** Whether either layer is drawing, which is when the window applies. */
    active: deathsOn || finishedOn,
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
