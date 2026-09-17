import { Button, NavGate } from "@picoframe/frame";
import { AccountPicker } from "../AccountPicker";
import { BansSection } from "../admin/BansSection";
import { PlayerLookupSection } from "../admin/PlayerLookupSection";
import { useMpServerAdmin } from "../navPredicates";
import { serverAdminKeys } from "../serverAdmin";
import {
  serverNameFor,
  useMultiplayer,
  useProtocolServers,
  usernameFromKey,
} from "../store";
import { useServerAdminKey } from "../useServerAdminKey";

/**
 * The Server admin page (issue #2772): one place a moderator or admin runs an
 * uberserver's moderation and admin commands. Later issues in the "Lobby
 * server admin tools (uberserver)" milestone each add a section here.
 *
 * Acts on one connection at a time, carried in the URL as `?server=` through
 * `useServerAdminKey`, the same pattern chat's `?server=` and the battle
 * room's use. With more than one qualifying connection an `AccountPicker`
 * chooses which one. With one, the page acts on it without asking.
 */
function ServerAdminPage() {
  const { connections, activeKey, openLoginPopover } = useMultiplayer();
  const servers = useProtocolServers();
  const keys = serverAdminKeys(connections, servers, activeKey);
  const [serverKey, setServerKey] = useServerAdminKey();

  if (keys.length === 0 || !serverKey) {
    return (
      <main className="flex flex-col items-center justify-center gap-4 p-10 text-center">
        <h1 className="text-lg font-semibold">Server admin</h1>
        <p className="text-sm text-muted-foreground">
          You are not a moderator or admin on any connected uberserver.
        </p>
        <Button onClick={openLoginPopover}>Connect…</Button>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Server admin</h1>
        <p className="text-sm text-muted-foreground">
          Acting as {usernameFromKey(serverKey)} on{" "}
          {serverNameFor(serverKey, servers)}.
        </p>
      </header>

      {keys.length > 1 && (
        <AccountPicker keys={keys} value={serverKey} onChange={setServerKey} />
      )}

      <PlayerLookupSection serverKey={serverKey} />

      <BansSection serverKey={serverKey} />

      <p className="text-sm text-muted-foreground">
        More moderation and admin tools land here in later issues.
      </p>
    </main>
  );
}

/** Route entry: gated on `useMpServerAdmin`, the same predicate the sidebar
 * item's `useVisible` uses, so a stale link or a bookmark cannot open this
 * for somebody who cannot use it. */
export default function ServerAdminRoute() {
  return (
    <NavGate use={useMpServerAdmin} redirectTo="/lobby">
      <ServerAdminPage />
    </NavGate>
  );
}
