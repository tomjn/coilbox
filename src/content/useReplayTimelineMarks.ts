import { useMemo } from "react";
import type { DemoInfo } from "./bindings";
import { analysisRunHidden, useStoredAnalyses } from "./replayAnalysis";
import { DEATH_KINDS, eventBlock, eventState } from "./replayEventLayers";
import type { PlacedMark } from "./replayMapView/timelineMarks";
import { describeEvent, markKind } from "./replayTimeline";
import { useReplayChat } from "./useReplayChat";
import { useEventRead } from "./useReplayEventLayers";

/** Whether the analysis has given the Kills lane its marks. */
export interface KillsLane {
  /** `needsAnalysis` when there is no analysis to read, `unreadable` when there
   *  is one that could not be read. */
  status: "ready" | "needsAnalysis" | "unreadable";
  /** Why there are no marks, in a sentence, when the analysis is missing. */
  reason: string | null;
}

/**
 * The events on the replay page's timeline dock (#5306), from the sources the
 * chat log and the events layers use, and no other.
 *
 * Chat lines, and players joining, pausing, resigning, giving everything away,
 * leaving and a team dying, come from the replay file through `useReplayChat`.
 * Each chat line carries who it was sent to, which the dock draws as a colour.
 * Kills are the analysis's `unit_destroyed` events, read through
 * `useEventRead`, as the map's deaths layer reads them. A replay with no
 * readable analysis has no kills, and `kills` says why. A replay whose file has
 * no chat has no chat marks.
 */
export function useReplayTimelineMarks(
  info: DemoInfo,
  replayPath: string,
): { marks: PlacedMark[]; kills: KillsLane } {
  const chat = useReplayChat(replayPath);
  const analyses = useStoredAnalyses();
  const stored =
    info.remixed || !info.gameId ? undefined : analyses.get(info.gameId);
  const state = eventState(info, stored, analysisRunHidden());
  const deaths = useEventRead(state, DEATH_KINDS, state.kind === "ready");

  const marks = useMemo(() => {
    const out: PlacedMark[] = [];
    for (const line of chat.messages ?? []) {
      out.push({
        lane: "chat",
        frame: line.frame,
        text: line.playerName ? `${line.playerName}: ${line.text}` : line.text,
        kind: markKind(line),
      });
    }
    for (const event of chat.events) {
      // An action this app does not name has nothing to say.
      if (event.type === "other") continue;
      out.push({
        lane: "players",
        frame: event.frame,
        text: describeEvent(event),
      });
    }
    for (const event of deaths.events) {
      if (typeof event.frame === "number") {
        out.push({ lane: "kills", frame: event.frame });
      }
    }
    return out;
  }, [chat.messages, chat.events, deaths.events]);

  const kills: KillsLane =
    state.kind !== "ready"
      ? { status: "needsAnalysis", reason: eventBlock(state) }
      : deaths.status === "failed"
        ? { status: "unreadable", reason: null }
        : { status: "ready", reason: null };
  return { marks, kills };
}
