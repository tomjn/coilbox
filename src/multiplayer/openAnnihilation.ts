import { useSetting } from "@picoframe/frame";
import type { OaProgram } from "../play/bindings";

/**
 * Where the Open Annihilation program is and which version it printed
 * (issue #4943), or `null` while none is set. The only place the frontend reads
 * it from: the settings section writes it, and the launcher and the battle
 * room read it back through this hook. A path is stored only after the program
 * ran, so a stored value is one that worked when it was chosen.
 */
export const OA_PROGRAM_KEY = "multiplayer.openAnnihilation";

export function useOpenAnnihilation() {
  return useSetting<OaProgram | null>(OA_PROGRAM_KEY, null);
}
