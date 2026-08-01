/**
 * The map's own start positions, and which of the scenario's participants would
 * spawn at each one.
 *
 * The positions come from the map through unitsync, already in elmos from the
 * north-west corner, which is the space the whole editor works in. What has to
 * be worked out here is who is standing on them.
 *
 * Under `StartPosType` 0 the engine spawns team `i` at the map's position `i`,
 * and a scenario's setup is a skirmish draft, so the answer is the draft's own:
 * `effectiveTeams` compacts the participants' chosen slots to 0..k-1 and that
 * index is the position index. Under any other start-pos type the spawn is
 * random or chosen in game, so a position is only a position.
 *
 * The three.js half is `startsLayer.ts`.
 */

import type { SkirmishDraft } from "@/play/drafts";
import { effectiveTeams, rgbToHex } from "@/play/participants";
import type { Point } from "../../model";

/** The `StartPosType` that keys a team's spawn to the map's own positions. */
export const FIXED_START_POS_TYPE = 0;

/** One of the map's start positions, and whoever the setup puts on it. */
export interface StartMarker {
  /** 0-based, which under a fixed start-pos type is also the engine team. */
  index: number;
  pos: Point;
  /** The participant that spawns here, or null when the setup does not say. */
  spawn: { name: string; colorHex: string } | null;
}

/**
 * The map's start positions as the editor should draw them.
 *
 * A position with no participant on it is still drawn: it is what an author
 * orients against, and a map having more positions than the setup has teams is
 * the ordinary case rather than a fault.
 */
export function startMarkers(
  positions: Point[],
  setup: SkirmishDraft,
): StartMarker[] {
  const fixed = setup.startPosType === FIXED_START_POS_TYPE;
  const { leaderIdByTeam } = effectiveTeams(setup.participants);
  const byId = new Map(setup.participants.map((p) => [p.id, p]));
  return positions.map((pos, index) => {
    const leaderId = fixed ? leaderIdByTeam[index] : undefined;
    const leader = leaderId ? byId.get(leaderId) : undefined;
    return {
      index,
      pos: { x: pos.x, z: pos.z },
      spawn: leader
        ? { name: leader.name, colorHex: rgbToHex(leader.color) }
        : null,
    };
  });
}

/** What a marker is labelled with: its number, and who is on it. */
export function markerLabel(marker: StartMarker): string {
  const number = `${marker.index + 1}`;
  return marker.spawn ? `${number} · ${marker.spawn.name}` : number;
}
