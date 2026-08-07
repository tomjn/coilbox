import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { Battle } from "../bindings";
import { BattleRow } from "./BattleRow";

type RowProps = {
  canJoin: boolean;
  onJoin: (b: Battle, key?: string) => void;
  onLeave: () => void;
  enginePath?: string;
  dataDir?: string;
  serverAddress?: string;
};

/**
 * The scrollable battle list, grouped by state: the battle you're in (if any) is
 * pinned on top so Leave is always reachable, then an "Open" group and an "In
 * progress" group (open first). Each group has a collapsible header with a count;
 * empty groups are omitted. `totalCount` is the unfiltered battle count so the
 * empty state can distinguish "no battles at all" from "filtered everything out".
 */
export function BattleList({
  battles,
  totalCount,
  joinedBattle,
  joinedId,
  inProgressIds,
  canJoin,
  onJoin,
  onLeave,
  enginePath,
  dataDir,
  serverAddress,
}: {
  battles: Battle[];
  totalCount: number;
  joinedBattle: Battle | undefined;
  joinedId: number | null;
  inProgressIds: Set<number>;
  canJoin: boolean;
  onJoin: (b: Battle, key?: string) => void;
  onLeave: () => void;
  enginePath?: string;
  dataDir?: string;
  /** This server's `host:port` (issue #498), threaded down to each row's
   * "Copy invite link" action. */
  serverAddress?: string;
}) {
  const [collapsed, setCollapsed] = useState({ open: false, running: false });
  const rowProps: RowProps = {
    canJoin,
    onJoin,
    onLeave,
    enginePath,
    dataDir,
    serverAddress,
  };

  const rest = battles.filter((b) => b.id !== joinedId);
  const open = rest.filter((b) => !inProgressIds.has(b.id));
  const running = rest.filter((b) => inProgressIds.has(b.id));

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
          <BattleRow battle={joinedBattle} joined {...rowProps} />
        </ul>
      )}
      <BattleGroup
        label="Open"
        battles={open}
        collapsed={collapsed.open}
        onToggle={() => setCollapsed((c) => ({ ...c, open: !c.open }))}
        rowProps={rowProps}
      />
      <BattleGroup
        label="In progress"
        battles={running}
        collapsed={collapsed.running}
        onToggle={() => setCollapsed((c) => ({ ...c, running: !c.running }))}
        rowProps={rowProps}
        inProgress
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
  inProgress = false,
}: {
  label: string;
  battles: Battle[];
  collapsed: boolean;
  onToggle: () => void;
  rowProps: RowProps;
  /** Every battle in this group is running (host in-game); rows offer "Watch
   * live" (spectator join) instead of "Join". */
  inProgress?: boolean;
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
              inProgress={inProgress}
              {...rowProps}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
