import { Button, Input } from "@picoframe/frame";
import { LogOut } from "lucide-react";
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
      <header className="flex flex-col gap-3 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Battles</h1>
          <span className="text-sm text-muted-foreground">
            {shown.length === all.length
              ? `(${all.length})`
              : `(${shown.length} of ${all.length})`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="flex-1"
            value={filters.search}
            onChange={(e) =>
              setFilters((f) => ({ ...f, search: e.target.value }))
            }
            placeholder="Search battles by title, map, host, or game"
          />
          <BattleFilterPopover filters={filters} setFilters={setFilters} />
        </div>
      </header>

      {joinedBattle && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-primary/5 px-4 py-2 text-sm">
          <span>
            You are in <strong>{joinedBattle.title}</strong>.
          </span>
          <Button
            className="h-8 px-3"
            onClick={leave}
            aria-label="Leave battle"
          >
            <LogOut className="mr-1 size-4" />
            Leave
          </Button>
        </div>
      )}

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
        joinedId={joinedId}
        canJoin={canJoin}
        onJoin={onJoin}
        enginePath={selected?.enginePath}
        dataDir={selected?.rootPath}
      />
    </main>
  );
}
