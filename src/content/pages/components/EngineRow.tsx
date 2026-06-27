import { Button } from "@picoframe/frame";
import { CheckCircle2, FolderOpen, Loader2 } from "lucide-react";
import type { Engine } from "../../bindings";
import { StatusBadge } from "./StatusBadge";

/** One engine install: version/platform, verified sync-version, and actions. */
export function EngineRow({
  engine,
  verifying,
  onVerify,
  onOpen,
}: {
  engine: Engine;
  verifying: boolean;
  onVerify: (engine: Engine) => void;
  onOpen: (path: string) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border/50 bg-card p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{engine.version}</span>
          {engine.platform && (
            <StatusBadge tone="neutral">{engine.platform}</StatusBadge>
          )}
          {engine.syncVersion && (
            <StatusBadge tone="good">
              <CheckCircle2 className="mr-1 size-3" />
              {engine.syncVersion}
            </StatusBadge>
          )}
        </div>
        <span
          className="break-all font-mono text-xs text-muted-foreground"
          title={engine.executable}
        >
          {engine.executable}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={verifying}
          onClick={() => onVerify(engine)}
        >
          {verifying ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          {engine.syncVersion ? "Re-verify" : "Verify"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpen(engine.path)}
        >
          <FolderOpen className="size-4" />
          Open
        </Button>
      </div>
    </li>
  );
}
