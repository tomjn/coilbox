import { Button } from "@picoframe/frame";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useState } from "react";

/**
 * Shown when the battle's game isn't installed locally. Game archives are hard to
 * resolve by name, so this points at the Downloads → Games page rather than
 * offering a direct download, plus a rescan for the already-on-disk case. (The
 * missing-map case is handled inline in the minimap box, see `MissingMapBox`.)
 */
export function MissingContentCard({
  gameName,
  onRescan,
}: {
  gameName: string;
  onRescan: () => Promise<void>;
}) {
  const [rescanning, setRescanning] = useState(false);

  async function rescan() {
    setRescanning(true);
    try {
      await onRescan();
    } finally {
      setRescanning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="size-4" />
        Game not installed
      </div>
      <p className="text-sm">
        <span className="font-medium">{gameName}</span> isn't installed —
        install it from <span className="font-medium">Downloads → Games</span>,
        then rescan.
      </p>
      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={rescanning}
          onClick={rescan}
        >
          <RefreshCw
            className={rescanning ? "size-4 animate-spin" : "size-4"}
          />
          {rescanning ? "Rescanning…" : "Rescan content"}
        </Button>
      </div>
    </div>
  );
}
