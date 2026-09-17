import { useSearchParams } from "react-router";
import { serverAdminKeys } from "./serverAdmin";
import { useMultiplayer, useProtocolServers } from "./store";

/**
 * The connection the Server admin page acts on, and a setter that writes the
 * pick back into the URL's `?server=` param (issue #2772). Left on the URL
 * rather than stripped, the same as the battle room's `?server=`
 * (`useBattleRoomKey`), so a reload or a shared link keeps the same
 * connection. Falls back to the first connection `serverAdminKeys` returns
 * (the focused one first) when the URL names none, or one that no longer
 * qualifies. Later sections of the page read the chosen connection through
 * this hook, so they cannot drift from what is on screen.
 */
export function useServerAdminKey(): [string | null, (key: string) => void] {
  const { connections, activeKey } = useMultiplayer();
  const servers = useProtocolServers();
  const [params, setParams] = useSearchParams();
  const keys = serverAdminKeys(connections, servers, activeKey);
  const requested = params.get("server");
  const serverKey =
    requested && keys.includes(requested) ? requested : (keys[0] ?? null);

  const pick = (key: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("server", key);
        return next;
      },
      { replace: true },
    );
  };

  return [serverKey, pick];
}
