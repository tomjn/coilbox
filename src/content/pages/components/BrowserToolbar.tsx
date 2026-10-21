import { Trans } from "@lingui/react/macro";
import { Button, cn } from "@picoframe/frame";
import { Loader2, RefreshCw } from "lucide-react";
import { Link } from "react-router";
import { type ScanTarget, targetKey, targetLabel } from "../../config";
import { TargetPicker } from "./TargetPicker";

/** What a content page shows when no content folder holds an engine. */
export function NoEngines() {
  return (
    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
      <Trans>
        No engines found in your content folders. Add a folder in{" "}
        <Link
          to="/settings/content-folders"
          className="underline underline-offset-4"
        >
          Content folders
        </Link>{" "}
        or install one from{" "}
        <Link to="/settings/engines" className="underline underline-offset-4">
          Engines
        </Link>
        .
      </Trans>
    </div>
  );
}

/**
 * Re-reads the engine on demand. While a scan is running it turns into a
 * spinning "Cancel scan" button when the caller supplies `onCancel`, so a slow
 * scan can be stopped in place. Callers whose refresh can't be cancelled (e.g.
 * a cheap engine-config read) omit `onCancel` and get a disabled spinner.
 */
export function RescanButton({
  onRescan,
  scanning,
  onCancel,
  className,
}: {
  onRescan: () => void;
  scanning: boolean;
  onCancel?: () => void;
  className?: string;
}) {
  return scanning && onCancel ? (
    <Button
      variant="outline"
      onClick={onCancel}
      className={cn("shrink-0 gap-1.5", className)}
    >
      <Loader2 className="size-4 animate-spin" />
      <Trans>Cancel scan</Trans>
    </Button>
  ) : (
    <Button
      onClick={onRescan}
      disabled={scanning}
      className={cn("shrink-0 gap-1.5", className)}
    >
      {scanning ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <RefreshCw className="size-4" />
      )}
      <Trans>Rescan</Trans>
    </Button>
  );
}

/**
 * Compact Content-browser controls. Without `onSelect`, or with a single
 * engine, it shows only a muted "via …" label. The picker appears on the pages
 * that edit an engine, when there's a real choice. A small Rescan button
 * re-reads the engine on demand. When no engine is available at all it points
 * the user at the settings pages instead.
 */
export function BrowserToolbar({
  targets,
  selectedKey,
  onSelect,
  onRescan,
  scanning,
  onCancel,
}: {
  targets: ScanTarget[];
  selectedKey: string;
  /** Omit it and the toolbar shows the engine but offers no choice. */
  onSelect?: (key: string) => void;
  onRescan: () => void;
  scanning: boolean;
  onCancel?: () => void;
}) {
  if (targets.length === 0) return <NoEngines />;

  const current =
    targets.find((t) => targetKey(t) === selectedKey) ?? targets[0];

  const currentLabel = targetLabel(current);

  return (
    <div className="flex items-center gap-2">
      {onSelect && targets.length > 1 ? (
        <TargetPicker
          targets={targets}
          value={selectedKey}
          onChange={onSelect}
          disabled={scanning}
        />
      ) : (
        <span
          className="min-w-0 truncate text-xs text-muted-foreground"
          title={current.enginePath}
        >
          <Trans>via {currentLabel}</Trans>
        </span>
      )}
      <RescanButton
        onRescan={onRescan}
        scanning={scanning}
        onCancel={onCancel}
        className="ml-auto"
      />
    </div>
  );
}
