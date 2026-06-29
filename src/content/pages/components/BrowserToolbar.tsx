import { Button } from "@picoframe/frame";
import { Loader2, RefreshCw } from "lucide-react";
import { Link } from "react-router";
import { type ScanTarget, targetKey } from "../../config";
import { TargetPicker } from "./TargetPicker";

/**
 * Compact Content-browser controls. With a single engine it stays out of the way
 * (just a muted "via …" label); the picker only appears when there's a real
 * choice. A small Rescan button re-reads the engine on demand. When no engine is
 * available at all it points the user at the settings pages instead.
 */
export function BrowserToolbar({
  targets,
  selectedKey,
  onSelect,
  onRescan,
  scanning,
}: {
  targets: ScanTarget[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onRescan: () => void;
  scanning: boolean;
}) {
  if (targets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        No engines found in your content folders. Add a folder in{" "}
        <Link
          to="/settings/content-folders"
          className="underline underline-offset-4"
        >
          Content Folders
        </Link>{" "}
        or install one from{" "}
        <Link to="/settings/engines" className="underline underline-offset-4">
          Engines
        </Link>
        .
      </div>
    );
  }

  const current =
    targets.find((t) => targetKey(t) === selectedKey) ?? targets[0];

  return (
    <div className="flex items-center gap-2">
      {targets.length > 1 ? (
        <TargetPicker
          targets={targets}
          value={selectedKey}
          onChange={onSelect}
          disabled={scanning}
        />
      ) : (
        <span
          className="min-w-0 truncate text-xs text-muted-foreground"
          title={current.rootPath}
        >
          via {current.engineVersion} · {current.rootLabel ?? current.rootPath}
        </span>
      )}
      <Button
        onClick={onRescan}
        disabled={scanning}
        className="ml-auto shrink-0 gap-1.5"
      >
        {scanning ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        Rescan
      </Button>
    </div>
  );
}
