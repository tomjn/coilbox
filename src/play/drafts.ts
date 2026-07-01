import { useSetting } from "@picoframe/frame";
import { initialParticipants, type Participant } from "./config";

/**
 * Working draft for the Singleplayer (skirmish) launcher, persisted through the
 * frame settings store. The page holds its selections in local state for snappy
 * editing; this draft backs that state so navigating away (or restarting the
 * app) doesn't lose the setup — the picked game, map, opponents and options all
 * come back. Transient run state (running/error) is intentionally not persisted.
 */
export interface SkirmishDraft {
  participants: Participant[];
  gameName: string;
  mapName: string;
  startPosType: number;
  modOptionValues: Record<string, string>;
}

export const defaultSkirmishDraft: SkirmishDraft = {
  participants: initialParticipants(),
  gameName: "",
  mapName: "",
  startPosType: 0,
  modOptionValues: {},
};

export function useSkirmishDraft() {
  return useSetting<SkirmishDraft>("play.skirmish", defaultSkirmishDraft);
}
