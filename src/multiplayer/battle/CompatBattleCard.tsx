import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { AlertTriangle, Download, Loader2, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router";
import { Progress } from "@/components/ui/progress";
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
  const { t } = useLingui();
  const navigate = useNavigate();
  const baseName = state.status === "building" ? state.baseName : "";
  const version = state.status === "building" ? state.version : 0;
  const progress = state.status === "building" ? state.progress : undefined;
  const total = progress?.total ?? 0;
  const done = progress ? Math.min(progress.done, total) : 0;
  const block = compatLaunchBlock(state);
  if (!block) return null;

  if (state.status === "building") {
    return (
      <div className="flex flex-col gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Loader2 className="size-3.5 animate-spin" />{" "}
          <Trans>
            Building{" "}
            <span className="font-medium text-foreground">
              {baseName} (compat {version})
            </span>
          </Trans>
          {total > 0 && (
            <span className="ml-auto text-xs">
              <Trans>
                {done} of{" "}
                <Plural value={total} one="# model" other="# models" />
              </Trans>
            </span>
          )}
        </div>
        {total > 0 && (
          <Progress
            value={(done / total) * 100}
            aria-label={t`Models converted`}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="size-4" />
        {state.status === "update"
          ? t`Host is on a newer coilbox`
          : block.short}
      </div>
      <p className="text-sm">{block.reason}</p>
      <div className="flex flex-wrap items-center gap-2">
        {state.status === "update" ? (
          <Button size="sm" onClick={() => navigate("/settings/updates")}>
            <Download className="size-4" />
            <Trans>Update coilbox</Trans>
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <RefreshCw className="size-4" />
            <Trans>Try again</Trans>
          </Button>
        )}
      </div>
    </div>
  );
}
