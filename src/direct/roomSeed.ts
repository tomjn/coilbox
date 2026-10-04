import { reconcileAi } from "@/conquest/ai";
import type { SkirmishDraft } from "@/play/drafts";
import { effectiveTeams } from "@/play/participants";
import { botWireName } from "../multiplayer/battle/fromSkirmish";
import { DEFAULT_ROOM_MAX_PLAYERS } from "./room";

/** One bot a room is opened with, as the setup described it. */
export interface RoomSeedBot {
  /** The name it goes under in the room, with no whitespace. */
  name: string;
  /** The AI's short name, or null when the game's AI list is not known yet and
   *  the setup chose none. */
  ai: string | null;
  /** The side's name, which can be the random-side marker. Turned into the
   *  game's side index once the room is up and the game's sides are known. */
  side: string;
  ally: number;
  teamId: number;
  /** The team bonus, in percent. */
  handicap: number;
}

export interface RoomSeed {
  gameName: string;
  mapName: string;
  maxPlayers: number;
  /** Seats left for people: everything but the host's own. Bots take none. */
  openHumanSlots: number;
  bots: RoomSeedBot[];
  /** Bots the room cannot host because the game offers no AI for them, by name. */
  skippedBots: string[];
}

/**
 * What a hosted room is opened with, given a skirmish setup. Pure.
 *
 * The room's game, map and size come from here. The options, start boxes and
 * the host's own seat are applied by the battle room once the room is up, the
 * same way they are for a battle on a lobby server (`draftToHostSeed`), because
 * they need the live battle. This decides the part that has to be known before
 * the room exists, and what a host is told about the bots before they press
 * start.
 *
 * Only the host's seat is taken. A setup has one human, and every other seat is
 * left for whoever joins. A room's seats count people only, so a bot never uses
 * one up.
 *
 * `ais` is the game's addable AI list. With it, a bot whose AI the game does not
 * offer is remapped as the battle room will remap it, or skipped when the game
 * offers nothing usable. Without it (the list has not loaded) every bot keeps
 * the AI the setup gave it.
 */
export function draftToRoomSeed(opts: {
  draft: SkirmishDraft;
  ais?: { shortName: string }[] | null;
}): RoomSeed {
  const { draft, ais } = opts;
  const { teamIndexById } = effectiveTeams(draft.participants);
  const taken = new Set<string>();
  const bots: RoomSeedBot[] = [];
  const skippedBots: string[] = [];
  for (const p of draft.participants) {
    if (p.kind !== "ai") continue;
    const name = botWireName(p.name, taken);
    let ai: string | null = p.ai?.shortName ?? null;
    if (ais) {
      const outcome = reconcileAi(p.ai, ais);
      if (!outcome.ai) {
        skippedBots.push(name);
        continue;
      }
      ai = outcome.ai.shortName;
    }
    bots.push({
      name,
      ai,
      side: p.side,
      ally: p.allyTeam,
      teamId: teamIndexById.get(p.id) ?? 0,
      handicap: p.handicap ?? 0,
    });
  }
  return {
    gameName: draft.gameName,
    mapName: draft.mapName,
    maxPlayers: DEFAULT_ROOM_MAX_PLAYERS,
    openHumanSlots: DEFAULT_ROOM_MAX_PLAYERS - 1,
    bots,
    skippedBots,
  };
}
