import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { FolderOpen, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/format";
import type { ContentRoot } from "../../bindings";
import { StatusBadge } from "./StatusBadge";

/** What a folder holds, as one line: "3 engines · 126 maps · …". */
function countsLine(counts: ContentRoot["counts"]): string {
  return [
    plural(counts.engines, { one: "# engine", other: "# engines" }),
    plural(counts.maps, { one: "# map", other: "# maps" }),
    plural(counts.games, { one: "# game", other: "# games" }),
    plural(counts.packages, { one: "# package", other: "# packages" }),
  ].join(" · ");
}

/**
 * One tracked content folder in the folder list: its path, what it holds, and
 * what can be done with it. Badges only say what is out of the ordinary, so a
 * healthy folder found by detection shows none.
 */
export function FolderRow({
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
  const scannedAt = root.lastScannedAt
    ? formatDateTime(new Date(root.lastScannedAt))
    : null;
  const isManual = root.source === "manual";
  const switchId = `folder-read-only-${root.id}`;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          {root.label && (
            <span className="shrink-0 font-medium">{root.label}</span>
          )}
          <span className="truncate font-mono" title={root.path}>
            {root.path}
          </span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
          {receives.map((what) => (
            <StatusBadge key={what} tone="good">
              {what}
            </StatusBadge>
          ))}
          {!root.valid && (
            <StatusBadge tone="warn">
              {root.exists ? t`not a Spring root` : t`missing`}
            </StatusBadge>
          )}
          {root.forced && (
            <StatusBadge tone="warn">
              <Trans>forced</Trans>
            </StatusBadge>
          )}
          {isManual && <StatusBadge tone="info">{t`manual`}</StatusBadge>}
          {(root.portable || root.kind === "portable") && (
            <StatusBadge tone="info">
              <Trans>portable</Trans>
            </StatusBadge>
          )}
          {root.bundled && (
            <StatusBadge tone="info">
              <Trans>bundled, read only</Trans>
            </StatusBadge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {countsLine(root.counts)}
        </p>
        <p className="text-xs text-muted-foreground">
          {root.origins.length > 0 && (
            <>
              <Trans>Detected via {origins}</Trans>
              {" · "}
            </>
          )}
          {scannedAt ? (
            <Trans>Scanned {scannedAt}</Trans>
          ) : (
            <Trans>Not scanned yet</Trans>
          )}
        </p>
      </div>
      <TooltipProvider>
        <div className="flex shrink-0 items-center gap-1">
          {!root.bundled && (
            <div className="mr-2 flex items-center gap-2">
              <Switch
                id={switchId}
                checked={root.readOnly === true}
                onCheckedChange={(v) => onSetReadOnly(root.path, v === true)}
              />
              <Label
                htmlFor={switchId}
                className="cursor-pointer text-xs font-normal text-muted-foreground"
              >
                <Trans>Read only</Trans>
              </Label>
            </div>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!root.exists}
                onClick={() => onOpen(root.path)}
                aria-label={t`Open`}
              >
                <FolderOpen className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <Trans>Open the folder</Trans>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || !root.exists}
                onClick={() => onRescan(root.path)}
                aria-label={t`Re-scan`}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <Trans>Count what is in this folder again</Trans>
            </TooltipContent>
          </Tooltip>
          {isManual && !root.bundled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(root.path)}
                  aria-label={t`Remove`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <Trans>
                  Stop reading this folder. Nothing in it is deleted.
                </Trans>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>
    </li>
  );
}
