import { useMemo } from "react";
import type { DemoInfo } from "./bindings";
import { analysisRunHidden, useStoredAnalyses } from "./replayAnalysis";
import { DEATH_KINDS, eventState } from "./replayEventLayers";
import type { PlacedMark } from "./replayMapView/timelineMarks";
import { describeEvent } from "./replayTimeline";
import { useReplayChat } from "./useReplayChat";
import { useEventRead } from "./useReplayEventLayers";

/**
 * The events on the replay timeline's bar (#3808), from the sources the chat
 * timeline of #410 and the events layers use, and no other.
 *
 * Chat lines and players leaving come from the replay file through
 * `useReplayChat`, as the chat timeline's do. Kills are the analysis's
 * `unit_destroyed` events, read through `useEventRead`, as the map's deaths
 * layer reads them. A replay with no readable analysis has no kills. A replay
 * whose file has no chat has no chat marks.
 */
export function useReplayTimelineMarks(
  info: DemoInfo,
  replayPath: string,
): PlacedMark[] {
  const chat = useReplayChat(replayPath);
  const analyses = useStoredAnalyses();
  const stored =
    info.remixed || !info.gameId ? undefined : analyses.get(info.gameId);
  const state = eventState(info, stored, analysisRunHidden());
  const deaths = useEventRead(state, DEATH_KINDS, state.kind === "ready");

  return useMemo(() => {
    const marks: PlacedMark[] = [];
    for (const line of chat.messages ?? []) {
      marks.push({
        lane: "chat",
        frame: line.frame,
        text: line.playerName ? `${line.playerName}: ${line.text}` : line.text,
      });
    }
    for (const event of chat.events) {
      if (event.type !== "playerLeft") continue;
      marks.push({
        lane: "left",
        frame: event.frame,
        text: describeEvent(event),
      });
    }
    for (const event of deaths.events) {
      if (typeof event.frame === "number") {
        marks.push({ lane: "kills", frame: event.frame });
      }
    }
    return marks;
  }, [chat.messages, chat.events, deaths.events]);
}
