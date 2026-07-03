import { Button, NavGate } from "@picoframe/frame";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useScanTargetSelection } from "../../content/config";
import { BattleFilterPopover } from "../battles/BattleFilterPopover";
import { BattleList } from "../battles/BattleList";
import {
  type BattleFilters,
  filterSortBattles,
} from "../battles/battleFilters";
import {
  HostBattlePopover,
  type OpenBattleArgs,
} from "../battles/HostBattlePopover";
import {
  type Battle,
  mpJoinBattle,
  mpLeaveBattle,
  mpOpenBattle,
} from "../bindings";
import { useMpRevealed, useMultiplayer } from "../store";

/**
 * The Battles hub: search + filter/sort controls over the live battle list, with
 * in-place join. Battles come from the mirror snapshot (kept fresh by the store's
 * delta→snapshot rule); joining is reflected by the joined banner rather than
 * navigating away. Connection lives on the Login page; disconnected shows a prompt.
 * Reachable only once the user has connected this session (see the `NavGate`
 * wrapper below); before that, the route redirects to Login.
 */
function BattlesPage() {
  const {
    mirror,
    activeKey,
    busy,
    lastJoinError,
    clearJoinError,
    openLoginPopover,
  } = useMultiplayer();
  const [filters, setFilters] = useState<BattleFilters>({
    search: "",
    hideEmpty: false,
    hideLockedPassworded: false,
    hideFull: false,
    sortKey: "players",
    sortDir: "desc",
  });

  const all = useMemo(
    () => Object.values(mirror.state?.battles ?? {}),
    [mirror.state?.battles],
  );
  const shown = useMemo(() => filterSortBattles(all, filters), [all, filters]);

  // Selected engine + content root for rendering local minimaps in the rows.
  const { selected } = useScanTargetSelection();

  const navigate = useNavigate();
  const ready = mirror.phase === "ready";
  const joinedId = mirror.state?.currentBattle ?? null;
  const canJoin = ready && !busy && joinedId == null;

  // After a user-initiated join lands (the ack sets `currentBattle`), go straight
  // to the battle room. Gated on `joiningRef` so merely revisiting this page while
  // already in a battle doesn't redirect.
  const joiningRef = useRef(false);
  useEffect(() => {
    if (joinedId != null && joiningRef.current) {
      joiningRef.current = false;
      navigate("/battle");
    }
  }, [joinedId, navigate]);
  const joinedBattle =
    joinedId != null ? mirror.state?.battles[String(joinedId)] : undefined;

  // A battle is "in progress" when its host is in-game; BattleList groups on this
  // (open first, in-progress last). The joined battle is pinned separately so its
  // Leave button is always reachable even inside a collapsed group.
  const users = mirror.state?.users;
  const inProgressIds = useMemo(() => {
    const ids = new Set<number>();
    if (users) {
      for (const b of all) {
        if (users[b.host]?.status.ingame) ids.add(b.id);
      }
    }
    return ids;
  }, [all, users]);

  // `key` is supplied by the row's password popover for passworded battles.
  async function onJoin(b: Battle, key?: string) {
    if (!activeKey) return;
    clearJoinError();
    joiningRef.current = true;
    try {
      await mpJoinBattle({ serverKey: activeKey, id: b.id, key });
    } catch {
      // Wire-level failures surface via lastJoinError or a disconnect.
      joiningRef.current = false;
    }
  }

  // Open a battle we host. The OPENBATTLE ack sets `currentBattle`, which the join
  // effect above turns into navigation to the room (same path as joining).
  async function onHost(args: OpenBattleArgs) {
    if (!activeKey) return;
    clearJoinError();
    joiningRef.current = true;
    try {
      await mpOpenBattle({ serverKey: activeKey, ...args });
    } catch {
      joiningRef.current = false;
    }
  }

  async function leave() {
    if (!activeKey) return;
    await mpLeaveBattle({ serverKey: activeKey }).catch(() => {});
  }

  if (!activeKey) {
    return (
      <main className="flex flex-col items-center justify-center gap-4 p-10 text-center">
        <h1 className="text-lg font-semibold">Battles</h1>
        <p className="text-sm text-muted-foreground">
          You are not connected to a lobby server.
        </p>
        <Button onClick={openLoginPopover}>Connect…</Button>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Battles</h1>
          <span className="text-sm text-muted-foreground">
            {shown.length === all.length
              ? `(${all.length})`
              : `(${shown.length} of ${all.length})`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <HostBattlePopover disabled={!canJoin} onHost={onHost} />
          <BattleFilterPopover filters={filters} setFilters={setFilters} />
        </div>
      </header>

      {lastJoinError && (
        <div
          role="alert"
          className="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          Join failed: {lastJoinError}
        </div>
      )}

      <BattleList
        battles={shown}
        totalCount={all.length}
        joinedBattle={joinedBattle}
        joinedId={joinedId}
        inProgressIds={inProgressIds}
        canJoin={canJoin}
        onJoin={onJoin}
        onLeave={leave}
        enginePath={selected?.enginePath}
        dataDir={selected?.rootPath}
      />
    </main>
  );
}

/** Route entry: gated behind having connected at least once this session. */
export default function BattlesRoute() {
  return (
    <NavGate use={useMpRevealed} redirectTo="/lobby">
      <BattlesPage />
    </NavGate>
  );
}
