import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LobbyProtocol } from "../../lobby-servers/config";
import type { Battle } from "../bindings";
import { BattleRow } from "./BattleRow";
import { type BattleGroupKey, groupBattles } from "./battleFilters";

const NO_FRIENDS: ReadonlyMap<number, string> = new Map();

type RowProps = {
  canJoin: boolean;
  linkable: boolean;
  onJoin: (b: Battle, key?: string) => void;
  onLeave: () => void;
  enginePath?: string;
  dataDir?: string;
  serverAddress?: string;
  directRoom?: boolean;
  leaves?: string | null;
  protocol?: LobbyProtocol;
};

/**
 * The scrollable battle list, grouped by state: the battle you're in (if any) is
 * pinned on top so Leave is always reachable, then "Open", "Passworded", "In
 * progress" and "Locked" groups (see `groupBattles`). Each group has a collapsible
 * header with a count; empty groups are omitted. `totalCount` is the unfiltered battle count so the
 * empty state can distinguish "no battles at all" from "filtered everything out".
 */
export function BattleList({
  battles,
  totalCount,
  joinedBattle,
  joinedId,
  inProgressIds,
  friendsHere = NO_FRIENDS,
  canJoin,
  linkable,
  onJoin,
  onLeave,
  enginePath,
  dataDir,
  serverAddress,
  directRoom,
  leaves = null,
  focusId,
  protocol,
}: {
  battles: Battle[];
  totalCount: number;
  joinedBattle: Battle | undefined;
  joinedId: number | null;
  inProgressIds: Set<number>;
  /** The friends in each battle, as a names string by battle id. */
  friendsHere?: ReadonlyMap<number, string>;
  canJoin: boolean;
  /** Whether the invite link is worth handing out: connected to the server,
   * full stop. Unlike `canJoin`, it doesn't gate on being busy or already in a
   * battle elsewhere. A link to a full battle, or to the one you're already
   * in, is still a reasonable thing to send (issue #2372). */
  linkable: boolean;
  onJoin: (b: Battle, key?: string) => void;
  onLeave: () => void;
  enginePath?: string;
  dataDir?: string;
  /** This connection's `host:port` (issue #498), threaded down to each row's
   * "Copy invite link" action. */
  serverAddress?: string;
  /** Whether that connection is a room rather than a server, which decides which
   * kind of link the rows offer (issue #1617). */
  directRoom?: boolean;
  /** What joining a battle here leaves behind under the one-battle rule
   * (issue #2844), or null. */
  leaves?: string | null;
  /** The battle a notification sent the player to. Its group is opened and its
   * row scrolled into view. */
  focusId?: number;
  /** The protocol of this connection's saved server entry (issue #3524). */
  protocol?: LobbyProtocol;
}) {
  // Running matches can be watched, so they start expanded. Passworded battles
  // are ones you cannot simply drop into, and locked ones nobody can enter, so
  // both start collapsed and keep the joinable list short.
  const [collapsed, setCollapsed] = useState<Record<BattleGroupKey, boolean>>({
    open: false,
    passworded: true,
    running: false,
    locked: true,
  });
  // Rebuilding this object every render would defeat `BattleRow`'s memo, since
  // it spreads into every row's props.
  const rowProps: RowProps = useMemo(
    () => ({
      canJoin,
      linkable,
      onJoin,
      onLeave,
      enginePath,
      dataDir,
      serverAddress,
      directRoom,
      leaves,
      protocol,
    }),
    [
      canJoin,
      linkable,
      onJoin,
      onLeave,
      enginePath,
      dataDir,
      serverAddress,
      directRoom,
      leaves,
      protocol,
    ],
  );

  const { open, passworded, running, locked } = groupBattles(
    battles,
    joinedId,
    inProgressIds,
  );
  const rest = battles.filter((b) => b.id !== joinedId);

  const focusGroup: BattleGroupKey | null =
    focusId === undefined
      ? null
      : locked.some((b) => b.id === focusId)
        ? "locked"
        : running.some((b) => b.id === focusId)
          ? "running"
          : passworded.some((b) => b.id === focusId)
            ? "passworded"
            : open.some((b) => b.id === focusId)
              ? "open"
              : null;
  useEffect(() => {
    if (focusGroup) setCollapsed((c) => ({ ...c, [focusGroup]: false }));
  }, [focusGroup]);

  if (totalCount === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        No open battles right now.
      </p>
    );
  }
  if (!joinedBattle && rest.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        No battles match your filters.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {joinedBattle && (
        <ul className="flex flex-col gap-2 p-4 pb-0">
          <BattleRow
            battle={joinedBattle}
            joined
            friendsHere={friendsHere.get(joinedBattle.id)}
            {...rowProps}
          />
        </ul>
      )}
      <BattleGroup
        label="Open"
        battles={open}
        collapsed={collapsed.open}
        onToggle={() => setCollapsed((c) => ({ ...c, open: !c.open }))}
        rowProps={rowProps}
        friendsHere={friendsHere}
        focusId={focusId}
        inProgressIds={inProgressIds}
      />
      <BattleGroup
        label="Passworded"
        battles={passworded}
        collapsed={collapsed.passworded}
        onToggle={() =>
          setCollapsed((c) => ({ ...c, passworded: !c.passworded }))
        }
        rowProps={rowProps}
        friendsHere={friendsHere}
        focusId={focusId}
        inProgressIds={inProgressIds}
      />
      <BattleGroup
        label="In progress"
        battles={running}
        collapsed={collapsed.running}
        onToggle={() => setCollapsed((c) => ({ ...c, running: !c.running }))}
        rowProps={rowProps}
        friendsHere={friendsHere}
        focusId={focusId}
        inProgressIds={inProgressIds}
      />
      <BattleGroup
        label="Locked"
        battles={locked}
        collapsed={collapsed.locked}
        onToggle={() => setCollapsed((c) => ({ ...c, locked: !c.locked }))}
        rowProps={rowProps}
        friendsHere={friendsHere}
        focusId={focusId}
        inProgressIds={inProgressIds}
      />
    </div>
  );
}

/** A collapsible, labelled group of battles. Renders nothing when empty. */
function BattleGroup({
  label,
  battles,
  collapsed,
  onToggle,
  rowProps,
  friendsHere,
  focusId,
  inProgressIds,
}: {
  label: string;
  battles: Battle[];
  collapsed: boolean;
  onToggle: () => void;
  rowProps: RowProps;
  friendsHere: ReadonlyMap<number, string>;
  focusId?: number;
  /** Rows of a running battle (host in-game) offer "Watch live" (spectator
   * join) instead of "Join". The Locked group mixes running and waiting rows. */
  inProgressIds: Set<number>;
}) {
  if (battles.length === 0) return null;
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1.5 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          aria-hidden
          className={`size-3.5 transition-transform ${
            collapsed ? "" : "rotate-90"
          }`}
        />
        {label}
        <span className="text-muted-foreground">{battles.length}</span>
      </button>
      {!collapsed && (
        <ul className="flex flex-col gap-2 px-4 pb-2">
          {battles.map((b) => (
            <BattleRow
              key={b.id}
              battle={b}
              joined={false}
              inProgress={inProgressIds.has(b.id)}
              friendsHere={friendsHere.get(b.id)}
              focused={b.id === focusId}
              {...rowProps}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
