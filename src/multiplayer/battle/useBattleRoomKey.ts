import { useSearchParams } from "react-router";
import { useMultiplayer } from "../store";
import { battleRoomKey, inBattleKey } from "./battleRoomKey";

/** The live connection the player is in a battle on, or null (issue #2844). */
export function useInBattleKey(): string | null {
  const { connections, activeKey } = useMultiplayer();
  return inBattleKey(connections, activeKey);
}

/**
 * The connection the battle room on screen draws, from its `?server=` param.
 * Left on the URL rather than stripped, unlike chat's, because it is where the
 * room is rather than an instruction to act once. See {@link battleRoomKey}
 * for a link that names no server.
 */
export function useBattleRoomKey(): string | null {
  const { connections, activeKey } = useMultiplayer();
  const [params] = useSearchParams();
  return battleRoomKey(connections, activeKey, params.get("server"));
}
