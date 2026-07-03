import { Button } from "@picoframe/frame";
import { useMemo, useState } from "react";
import { useScanTargetSelection } from "../../content/config";
import { BattleFilterPopover } from "../battles/BattleFilterPopover";
import { BattleList } from "../battles/BattleList";
import {
  type BattleFilters,
  filterSortBattles,
} from "../battles/battleFilters";
import { type Battle, mpJoinBattle, mpLeaveBattle } from "../bindings";
import { useMultiplayer } from "../store";

/**
 * The Battles hub: search + filter/sort controls over the live battle list, with
 * in-place join. Battles come from the mirror snapshot (kept fresh by the store's
 * delta→snapshot rule); joining is reflected by the joined banner rather than
 * navigating away. Connection lives on the Lobby page; disconnected shows a prompt.
 */
export default function BattlesPage() {
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

  const ready = mirror.phase === "ready";
  const joinedId = mirror.state?.currentBattle ?? null;
  const canJoin = ready && !busy && joinedId == null;
  const joinedBattle =
    joinedId != null ? mirror.state?.battles[String(joinedId)] : undefined;

  // Pin the battle you're in to the top, regardless of filters/sort, so it (and
  // its Leave button) is always reachable — even if a filter would hide it.
  const ordered = useMemo(() => {
    if (!joinedBattle) return shown;
    return [joinedBattle, ...shown.filter((b) => b.id !== joinedId)];
  }, [shown, joinedBattle, joinedId]);

  // `key` is supplied by the row's password popover for passworded battles.
  async function onJoin(b: Battle, key?: string) {
    if (!activeKey) return;
    clearJoinError();
    try {
      await mpJoinBattle({ serverKey: activeKey, id: b.id, key });
    } catch {
      // Wire-level failures surface via lastJoinError or a disconnect.
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
        <BattleFilterPopover filters={filters} setFilters={setFilters} />
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
        battles={ordered}
        totalCount={all.length}
        joinedId={joinedId}
        canJoin={canJoin}
        onJoin={onJoin}
        onLeave={leave}
        enginePath={selected?.enginePath}
        dataDir={selected?.rootPath}
      />
    </main>
  );
}
