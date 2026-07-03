import { Button, Input } from "@picoframe/frame";
import { LogOut } from "lucide-react";
import { useMemo, useState } from "react";
import { BattleList } from "../battles/BattleList";
import {
  type BattleFilters,
  type BattleSortKey,
  filterSortBattles,
} from "../battles/battleList";
import { type Battle, mpJoinBattle, mpLeaveBattle } from "../bindings";
import { useMultiplayer } from "../store";

const SORTS: { key: BattleSortKey; label: string }[] = [
  { key: "players", label: "Players" },
  { key: "map", label: "Map" },
  { key: "game", label: "Game" },
];

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
          <span className="text-sm text-muted-foreground">({all.length})</span>
        </div>
        <Input
          value={filters.search}
          onChange={(e) =>
            setFilters((f) => ({ ...f, search: e.target.value }))
          }
          placeholder="Search battles by title, map, host, or game"
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Toggle
            label="Hide empty"
            on={filters.hideEmpty}
            onClick={() =>
              setFilters((f) => ({ ...f, hideEmpty: !f.hideEmpty }))
            }
          />
          <Toggle
            label="Hide locked"
            on={filters.hideLockedPassworded}
            onClick={() =>
              setFilters((f) => ({
                ...f,
                hideLockedPassworded: !f.hideLockedPassworded,
              }))
            }
          />
          <Toggle
            label="Hide full"
            on={filters.hideFull}
            onClick={() => setFilters((f) => ({ ...f, hideFull: !f.hideFull }))}
          />
          <span className="ml-2 text-muted-foreground">Sort:</span>
          {SORTS.map((s) => (
            <Toggle
              key={s.key}
              label={
                s.key === filters.sortKey
                  ? `${s.label} ${filters.sortDir === "desc" ? "↓" : "↑"}`
                  : s.label
              }
              on={s.key === filters.sortKey}
              onClick={() =>
                setFilters((f) =>
                  f.sortKey === s.key
                    ? { ...f, sortDir: f.sortDir === "desc" ? "asc" : "desc" }
                    : { ...f, sortKey: s.key, sortDir: "desc" },
                )
              }
            />
          ))}
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
      />
    </main>
  );
}

function Toggle({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className={`h-7 px-2 ${on ? "" : "opacity-60"}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
