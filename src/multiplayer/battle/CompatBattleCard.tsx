import { Button } from "@picoframe/frame";
import { AlertTriangle, Download, Loader2, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router";
import { type CompatBattleState, compatLaunchBlock } from "./compatBattle";

/**
 * Where the compat mutator a battle names stands (issue #4564). Building shows
 * the same state as the Compatibility mode switch. A host on a newer coilbox
 * sends the player to the updater, and a failed build can be tried again.
 * Renders nothing when the battle names no mutator, or this machine has it.
 */
export function CompatBattleCard({
  state,
  onRetry,
}: {
  state: CompatBattleState;
  onRetry: () => void;
}) {
  const navigate = useNavigate();
  const block = compatLaunchBlock(state);
  if (!block) return null;

  if (state.status === "building") {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border p-4 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Building
        <span className="font-medium text-foreground">
          {state.baseName} (compat {state.version})
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="size-4" />
        {state.status === "update" ? "Host is on a newer coilbox" : block.short}
      </div>
      <p className="text-sm">{block.reason}</p>
      <div className="flex flex-wrap items-center gap-2">
        {state.status === "update" ? (
          <Button size="sm" onClick={() => navigate("/settings/updates")}>
            <Download className="size-4" />
            Update coilbox
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <RefreshCw className="size-4" />
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
