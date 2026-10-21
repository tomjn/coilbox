import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { FolderOpen, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { CheckField } from "@/components/Field";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type { ContentRoot } from "../../bindings";
import { StatusBadge } from "./StatusBadge";

function fmtTime(ms?: number): string {
  return ms ? formatDateTime(new Date(ms)) : t`never`;
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
  receives = [],
  busy,
  onRescan,
  onRemove,
  onSetReadOnly,
  onOpen,
}: {
  root: ContentRoot;
  /** What new content is downloaded into this folder, as badge text. Empty for
   *  a folder nothing is downloaded into. */
  receives?: string[];
  busy: boolean;
  onRescan: (path: string) => void;
  onRemove: (path: string) => void;
  onSetReadOnly: (path: string, readOnly: boolean) => void;
  onOpen: (path: string) => void;
}) {
  const { t } = useLingui();
  const origins = root.origins.join(", ");
  const scannedAt = fmtTime(root.lastScannedAt);
  const isManual = root.source === "manual";
  return (
    <Card className="gap-4 rounded-lg border-border/50 p-4 shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="break-all font-mono text-sm" title={root.path}>
            {root.label ? (
              <span className="mr-2 font-sans font-medium">{root.label}</span>
            ) : null}
            {root.path}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {receives.map((what) => (
              <StatusBadge key={what} tone="good">
                {what}
              </StatusBadge>
            ))}
            <StatusBadge tone={isManual ? "info" : "neutral"}>
              {isManual ? t`manual` : t`auto`}
            </StatusBadge>
            <StatusBadge tone="neutral">{root.kind}</StatusBadge>
            {root.portable ? (
              <StatusBadge tone="info">
                <Trans>portable</Trans>
              </StatusBadge>
            ) : null}
            {root.bundled ? (
              <StatusBadge tone="info">
                <Trans>bundled, read only</Trans>
              </StatusBadge>
            ) : root.readOnly ? (
              <StatusBadge tone="info">
                <Trans>read only</Trans>
              </StatusBadge>
            ) : null}
            {root.valid ? (
              <StatusBadge tone="good">
                <Trans>valid</Trans>
              </StatusBadge>
            ) : (
              <StatusBadge tone="warn">
                {root.exists ? t`not a Spring root` : t`missing`}
              </StatusBadge>
            )}
            {root.forced ? (
              <StatusBadge tone="warn">
                <Trans>forced</Trans>
              </StatusBadge>
            ) : null}
          </div>
          {root.origins.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <Trans>detected via {origins}</Trans>
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Stat label={t`engines`} value={root.counts.engines} />
        <Stat label={t`maps`} value={root.counts.maps} />
        <Stat label={t`games`} value={root.counts.games} />
        <Stat label={t`packages`} value={root.counts.packages} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          <Trans>scanned {scannedAt}</Trans>
        </span>
        <div className="flex items-center gap-2">
          {!root.bundled && (
            <CheckField
              label={t`Read only`}
              checked={root.readOnly === true}
              onChange={(v) => onSetReadOnly(root.path, v)}
            />
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!root.exists}
            onClick={() => onOpen(root.path)}
          >
            <FolderOpen className="size-4" />
            <Trans>Open</Trans>
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
            <Trans>Re-scan</Trans>
          </Button>
          {isManual && !root.bundled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onRemove(root.path)}
            >
              <Trash2 className="size-4" />
              <Trans>Remove</Trans>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
