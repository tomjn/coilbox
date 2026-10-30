import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Loader2, RefreshCw, Wrench } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { HostCompat } from "./useHostCompat";

/**
 * The choice between a game's compat mutator and the game itself, under the Game
 * field of a host form (issue #4712). Draws nothing unless the host's switch is on
 * for the game, and names the compat version the battle will use.
 */
export function HostCompatChoice({ compat }: { compat: HostCompat }) {
  const { t } = useLingui();
  if (!compat.offered) return null;
  const { status, mutatorName, problem, progress } = compat;
  const total = progress?.total ?? 0;
  const done = progress ? Math.min(progress.done, total) : 0;

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={compat.useMutator ? "mutator" : "game"}
        onValueChange={(v) => v && compat.chooseMutator(v === "mutator")}
        aria-label={t`Which version to run`}
        className="self-start"
      >
        <ToggleGroupItem value="mutator">
          <Trans>Compatibility mode</Trans>
        </ToggleGroupItem>
        <ToggleGroupItem value="game">
          <Trans>Original game</Trans>
        </ToggleGroupItem>
      </ToggleGroup>

      {compat.useMutator && (
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex items-center gap-1.5">
            {(status === "checking" || status === "building") && (
              <Loader2
                className="size-3.5 motion-safe:animate-spin"
                aria-hidden
              />
            )}
            {mutatorName && <span className="font-medium">{mutatorName}</span>}
            {status === "building" && (
              <span className="ml-auto text-muted-foreground">
                {total > 0 ? (
                  <Trans>
                    {done} of{" "}
                    <Plural value={total} one="# model" other="# models" />
                  </Trans>
                ) : (
                  <Trans>Building</Trans>
                )}
              </span>
            )}
            {status === "needs-build" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto h-6 gap-1 px-2"
                onClick={compat.build}
              >
                <Wrench className="size-3.5" />
                {compat.rebuild ? <Trans>Rebuild</Trans> : <Trans>Build</Trans>}
              </Button>
            )}
            {status === "failed" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto h-6 gap-1 px-2"
                onClick={compat.recheck}
              >
                <RefreshCw className="size-3.5" />
                <Trans>Retry</Trans>
              </Button>
            )}
          </div>
          {status === "building" && total > 0 && (
            <Progress
              value={(done / total) * 100}
              aria-label={t`Models converted`}
            />
          )}
          {problem && <p className="text-destructive">{problem}</p>}
        </div>
      )}
    </div>
  );
}
