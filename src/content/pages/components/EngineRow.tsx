import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { CheckCircle2, FolderOpen, Loader2, Star } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Engine } from "../../bindings";

/** The executable's path inside its content folder, which the list's heading
 *  already names. */
function pathInRoot(engine: Engine): string {
  const root = engine.rootPath.replace(/[\\/]+$/, "");
  const exe = engine.executable;
  if (root && exe.startsWith(root) && /[\\/]/.test(exe[root.length] ?? "")) {
    return exe.slice(root.length + 1);
  }
  return exe;
}

/**
 * One engine install: its version, whether it has been checked, where it is,
 * and what can be done with it. The preferred engine shows a star where the
 * others have "Set preferred", so the actions line up down the list.
 */
export function EngineRow({
  engine,
  verifying,
  isPreferred,
  onVerify,
  onSetPreferred,
  onOpen,
}: {
  engine: Engine;
  verifying: boolean;
  isPreferred: boolean;
  onVerify: (engine: Engine) => void;
  onSetPreferred: (engine: Engine) => void;
  onOpen: (path: string) => void;
}) {
  const { t } = useLingui();
  const sync = engine.syncVersion;
  // A checked engine that reports its folder's own name says nothing new, so
  // only a different answer is spelled out.
  const reportsOther = sync && sync.split(" ")[0] !== engine.version;
  const verifyLabel = sync ? t`Re-verify` : t`Verify`;

  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {engine.version}
          {sync && !reportsOther && (
            <CheckCircle2
              className="size-3.5 text-emerald-500"
              aria-label={t`Verified`}
            />
          )}
        </p>
        <p
          className="truncate font-mono text-xs text-muted-foreground"
          title={engine.executable}
        >
          {reportsOther && (
            <span className="font-sans text-emerald-600 dark:text-emerald-400">
              <Trans>reports {sync}</Trans>
              {" · "}
            </span>
          )}
          {pathInRoot(engine)}
        </p>
      </div>
      <TooltipProvider>
        <div className="flex shrink-0 items-center gap-1">
          {isPreferred ? (
            <span className="flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <Star className="size-3.5 fill-current" />
              <Trans>Preferred</Trans>
            </span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onSetPreferred(engine)}
            >
              <Star className="size-3.5" />
              <Trans>Set preferred</Trans>
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={verifying}
                onClick={() => onVerify(engine)}
                aria-label={verifyLabel}
              >
                {verifying ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {sync
                ? t`Run the engine again to read its version`
                : t`Run the engine to read its version`}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpen(engine.path)}
                aria-label={t`Open`}
              >
                <FolderOpen className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <Trans>Open the engine's folder</Trans>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </li>
  );
}
