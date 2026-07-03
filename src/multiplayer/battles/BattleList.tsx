import type { Battle } from "../bindings";
import { BattleRow } from "./BattleRow";

/**
 * The scrollable battle list. `totalCount` is the unfiltered battle count so the
 * empty state can distinguish "no battles at all" from "filtered everything out".
 */
export function BattleList({
  battles,
  totalCount,
  joinedId,
  canJoin,
  onJoin,
  enginePath,
  dataDir,
}: {
  battles: Battle[];
  totalCount: number;
  joinedId: number | null;
  canJoin: boolean;
  onJoin: (b: Battle, key?: string) => void;
  enginePath?: string;
  dataDir?: string;
}) {
  if (totalCount === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        No open battles right now.
      </p>
    );
  }
  if (battles.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        No battles match your filters.
      </p>
    );
  }
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-4">
      {battles.map((b) => (
        <BattleRow
          key={b.id}
          battle={b}
          joined={b.id === joinedId}
          canJoin={canJoin}
          onJoin={onJoin}
          enginePath={enginePath}
          dataDir={dataDir}
        />
      ))}
    </ul>
  );
}
