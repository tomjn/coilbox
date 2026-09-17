import { Button, NavGate } from "@picoframe/frame";
import { useSearchParams } from "react-router";
import { PageHeader } from "@/components/PageHeader";
import { AccountPicker } from "../AccountPicker";
import { useIsServerAdmin } from "../AdminOnly";
import { AdminToolNav } from "../admin/AdminToolNav";
import { chosenToolId, visibleTools } from "../admin/toolNav";
import { ADMIN_TOOLS } from "../admin/tools";
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
 * server admin tools (uberserver)" milestone each add a tool to
 * `ADMIN_TOOLS` in `admin/tools.tsx`.
 *
 * Laid out as a left-hand list of tools and one tool beside it (issue #2918),
 * the same list-and-detail shape as Chat and Chat logs. The chosen tool is in
 * the URL as `?tool=`, see `chosenToolId` for how the older `?player=` and
 * `?ban=` links still land on theirs. Only the chosen tool is mounted, so
 * opening the page does not queue every tool's first command.
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
  const [params] = useSearchParams();
  const tools = visibleTools(ADMIN_TOOLS, useIsServerAdmin());
  const currentId = chosenToolId(params, tools);
  const current = tools.find((tool) => tool.id === currentId) ?? tools[0];

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

  const Tool = current.Component;

  return (
    <main className="flex h-full min-h-0 flex-col">
      <PageHeader
        className="border-b border-border px-4 py-3"
        title="Server admin"
        description={`Acting as ${usernameFromKey(serverKey)} on ${serverNameFor(serverKey, servers)}.`}
        actions={
          keys.length > 1 && (
            <AccountPicker
              keys={keys}
              value={serverKey}
              onChange={setServerKey}
            />
          )
        }
      />

      <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[13rem_minmax(0,1fr)]">
        <AdminToolNav tools={tools} current={current.id} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="max-w-4xl p-6">
            <Tool serverKey={serverKey} />
          </div>
        </div>
      </div>
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
