import { useSetting } from "@picoframe/frame";
import { ChevronRight } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useScanTargetSelection } from "../../content/config";
import { leaveBattle } from "../battle/leaveBattle";
import type { Battle } from "../bindings";
import { favouritesFor, useFavourites } from "../friends";
import { protocolForKey } from "../protocol";
import {
  initialMirror,
  serverAddressFromKey,
  serverNameFor,
  useConnection,
  useMultiplayer,
  useProtocolServers,
  usernameFromKey,
} from "../store";
import { BattleRow } from "./BattleRow";
import { type FriendBattle, friendBattles } from "./friendBattles";
import { joinBattle } from "./joinBattle";
import { useOneBattleRule } from "./oneBattle";

/** The setting that holds whether the section is collapsed. */
export const FRIEND_BATTLES_COLLAPSED_KEY =
  "multiplayer.friendBattlesCollapsed";

/**
 * Every battle with a friend in it, from every connection, in one collapsible
 * section above the per-connection lists (issue #3694). Renders nothing when no
 * battle has a friend in it. The battles stay in their own connection's list
 * too, and the filters there do not apply here.
 */
export function FriendBattles({
  battlesByKey,
  awaitLanding,
  giveUp,
}: {
  /** Each live connection's battles, before that list's filters. */
  battlesByKey: Record<string, Battle[]>;
  /** A join on this connection is under way, so the page should take the
   * player to the battle room when it lands. */
  awaitLanding: (serverKey: string) => void;
  /** That join failed before it reached the server. */
  giveUp: (serverKey: string) => void;
}) {
  const { connections } = useMultiplayer();
  const [favourites] = useFavourites();
  const [collapsed, setCollapsed] = useSetting<boolean>(
    FRIEND_BATTLES_COLLAPSED_KEY,
    false,
  );
  const found = useMemo(
    () =>
      friendBattles(
        Object.entries(battlesByKey).map(([serverKey, battles]) => {
          const state = connections[serverKey]?.mirror.state;
          return {
            serverKey,
            battles,
            users: state?.users,
            friends: new Set([
              ...favouritesFor(favourites, serverKey),
              ...(state?.friends ?? []),
            ]),
          };
        }),
      ),
    [battlesByKey, connections, favourites],
  );
  if (found.length === 0) return null;
  return (
    <section className="border-b border-border">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1.5 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          aria-hidden
          className={`size-3.5 transition-transform ${
            collapsed ? "" : "rotate-90"
          }`}
        />
        Friends
        <span className="text-muted-foreground">{found.length}</span>
      </button>
      {!collapsed && (
        <ul className="flex flex-col gap-2 px-4 pb-2">
          {found.map((entry) => (
            <FriendBattleRow
              key={`${entry.serverKey}:${entry.battle.id}`}
              entry={entry}
              awaitLanding={awaitLanding}
              giveUp={giveUp}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One battle, joined on the connection it belongs to. */
function FriendBattleRow({
  entry: { serverKey, battle, names, group },
  awaitLanding,
  giveUp,
}: {
  entry: FriendBattle;
  awaitLanding: (serverKey: string) => void;
  giveUp: (serverKey: string) => void;
}) {
  const { busy } = useMultiplayer();
  const connection = useConnection(serverKey);
  const mirror = connection?.mirror ?? initialMirror;
  const servers = useProtocolServers();
  const { selected } = useScanTargetSelection();
  const { leaveOther, notice } = useOneBattleRule(serverKey);
  const ready = mirror.phase === "ready";
  const joinedId = mirror.state?.currentBattle ?? null;

  const onJoin = useCallback(
    (b: Battle, key?: string) =>
      joinBattle({
        serverKey,
        battle: b,
        key,
        leaveOther,
        awaitLanding: () => awaitLanding(serverKey),
        giveUp: () => giveUp(serverKey),
      }),
    [serverKey, leaveOther, awaitLanding, giveUp],
  );
  const onLeave = useCallback(async () => {
    await leaveBattle(serverKey).catch(() => {});
  }, [serverKey]);

  return (
    <BattleRow
      battle={battle}
      joined={battle.id === joinedId}
      canJoin={ready && !busy && joinedId == null}
      linkable={ready}
      inProgress={group === "running"}
      friendsHere={names}
      connectionLabel={`${usernameFromKey(serverKey)} on ${serverNameFor(serverKey, servers)}`}
      onJoin={onJoin}
      onLeave={onLeave}
      enginePath={selected?.enginePath}
      dataDir={selected?.rootPath}
      serverAddress={serverAddressFromKey(serverKey)}
      directRoom={connection?.direct ?? false}
      leaves={notice("join")}
      protocol={protocolForKey(serverKey, servers)}
    />
  );
}
