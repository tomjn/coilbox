import { Button } from "@picoframe/frame";
import { FolderOpen, Loader2, RefreshCw, Trash2 } from "lucide-react";
import type { ContentRoot } from "../../bindings";
import { StatusBadge } from "./StatusBadge";

function fmtTime(ms?: number): string {
  return ms ? new Date(ms).toLocaleString() : "never";
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-lg font-semibold tabular-nums leading-none">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/** One tracked content folder: path, status badges, counts, and per-root actions. */
export function RootCard({
  root,
  busy,
  onRescan,
  onRemove,
  onOpen,
}: {
  root: ContentRoot;
  busy: boolean;
  onRescan: (path: string) => void;
  onRemove: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const isManual = root.source === "manual";
  return (
    <article className="flex flex-col gap-4 rounded-lg border border-border/50 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="break-all font-mono text-sm" title={root.path}>
            {root.label ? (
              <span className="mr-2 font-sans font-medium">{root.label}</span>
            ) : null}
            {root.path}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tone={isManual ? "info" : "neutral"}>
              {isManual ? "manual" : "auto"}
            </StatusBadge>
            <StatusBadge tone="neutral">{root.kind}</StatusBadge>
            {root.valid ? (
              <StatusBadge tone="good">valid</StatusBadge>
            ) : (
              <StatusBadge tone="warn">
                {root.exists ? "not a Spring root" : "missing"}
              </StatusBadge>
            )}
            {root.forced ? <StatusBadge tone="warn">forced</StatusBadge> : null}
          </div>
          {root.origins.length > 0 && (
            <p className="text-xs text-muted-foreground">
              detected via {root.origins.join(", ")}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Stat label="engines" value={root.counts.engines} />
        <Stat label="maps" value={root.counts.maps} />
        <Stat label="games" value={root.counts.games} />
        <Stat label="packages" value={root.counts.packages} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          scanned {fmtTime(root.lastScannedAt)}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!root.exists}
            onClick={() => onOpen(root.path)}
          >
            <FolderOpen className="size-4" />
            Open
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !root.exists}
            onClick={() => onRescan(root.path)}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Re-scan
          </Button>
          {isManual && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onRemove(root.path)}
            >
              <Trash2 className="size-4" />
              Remove
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
