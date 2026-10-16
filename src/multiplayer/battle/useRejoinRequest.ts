import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * Ask the server for a running Zero-K match when the player arrived here by
 * accepting its rejoin offer (issue #4198).
 *
 * The offer navigates to the room with `rejoinBattleId` rather than asking from
 * wherever the player was. The room is what launches the engine when the
 * server's answer arrives, and it only acts on an answer that comes after it
 * mounted, so the request has to wait for it. It goes out once the room holds
 * that battle, once per battle, and the state is then dropped so going back to
 * this history entry does not ask again.
 */
export function useRejoinRequest(
  roomBattleId: number | null,
  askForMatch: (() => Promise<void>) | null,
) {
  const location = useLocation();
  const navigate = useNavigate();
  const wanted = (location.state as { rejoinBattleId?: number } | null)
    ?.rejoinBattleId;
  const asked = useRef<number | null>(null);
  useEffect(() => {
    if (wanted == null || roomBattleId !== wanted) return;
    if (!askForMatch || asked.current === wanted) return;
    asked.current = wanted;
    void askForMatch();
    navigate(location, { replace: true, state: null });
  }, [wanted, roomBattleId, askForMatch, navigate, location]);
}
