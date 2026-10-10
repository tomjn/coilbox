import { useEffect, useState } from "react";
import type { ScanResult } from "./bindings";
import { useUnitsyncScan } from "./config";
import { readLastScan } from "./lastScan";

/** Where the live scan of a target stands. */
export type ScanCheck = "checking" | "checked" | "failed";

/**
 * `useUnitsyncScan` plus the last scan saved for the target, for a list page
 * that would rather show something at once (issue #3715).
 *
 * `data` and `unvouched` are the live scan, as `useUnitsyncScan` returns them.
 * `result` is what a list should draw: the live scan, else the saved one. While
 * `unchecked` is true the list is the saved scan, which can name an archive that
 * has since been deleted. Nothing may act on it as proof of what is installed.
 *
 * `status` is `checked` once the live scan has answered, `checking` while it
 * runs, and `failed` when it failed or was cancelled. `failed` keeps the saved
 * list, marked unchecked, rather than dropping it.
 */
export function useScanWithLastKnown(enginePath?: string, dataDir?: string) {
  const live = useUnitsyncScan(enginePath, dataDir);
  const key = enginePath && dataDir ? `${dataDir}::${enginePath}` : "";
  const [saved, setSaved] = useState<{ key: string; scan: ScanResult } | null>(
    null,
  );

  // What the disk held for this target. A live result that landed first wins.
  useEffect(() => {
    if (!enginePath || !dataDir) return;
    let stale = false;
    readLastScan(enginePath, dataDir).then((scan) => {
      if (stale || !scan) return;
      setSaved((cur) => (cur?.key === key ? cur : { key, scan }));
    });
    return () => {
      stale = true;
    };
  }, [enginePath, dataDir, key]);

  // The newest live answer is the best saved one if a later rescan fails.
  const liveData = live.data;
  useEffect(() => {
    if (liveData && key) setSaved({ key, scan: liveData });
  }, [liveData, key]);

  // A saved scan with nothing in it is no first paint, and drawn as the list it
  // would say "none installed" about a library nobody has checked.
  const savedScan = saved?.key === key ? saved.scan : null;
  const lastKnown =
    savedScan && (savedScan.maps.length > 0 || savedScan.games.length > 0)
      ? savedScan
      : null;
  const unchecked = !live.data && !!lastKnown;
  const status: ScanCheck = live.data
    ? "checked"
    : live.error || live.cancelled
      ? "failed"
      : "checking";
  return {
    ...live,
    result: live.data ?? lastKnown ?? live.unvouched,
    unchecked,
    status,
  };
}
