import { Button, useSetting } from "@picoframe/frame";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { contentRescan, contentStateLoad } from "./bindings";
import {
  cancelStartupScan,
  primeScan,
  primeThumbnails,
  setStartupState,
  targetKey,
  targetsFromState,
  useContentPrefs,
  useContentStartup,
} from "./config";

/**
 * App-launch warm-up for the Content plugin. Mounted as the plugin's `Provider`,
 * so this runs once at startup (before any route opens) rather than the first
 * time the Maps/Games pages are navigated to — the unitsync scan and the maps
 * grid thumbnails are then already in cache when the user arrives.
 *
 * The scan is surfaced through the shared startup store so a failure/slow scan is
 * visible (with Retry/Cancel) instead of a silent hang. Thumbnails are the slow
 * "everything after"; they run in the background and never gate the lists.
 */
export default function ContentStartupProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [prefs] = useContentPrefs();
  const [selectedKey] = useSetting<string>("content.scanTarget", "");
  const ran = useRef(false);
  const startup = useContentStartup();

  const warmUp = useCallback(
    async (force = false) => {
      const opId = crypto.randomUUID();
      setStartupState({ status: "scanning", opId });
      try {
        let { state } = await contentStateLoad(undefined);
        // First run with no prior snapshot: detect standard data roots first, so
        // there's a target to scan (the same step the Folders section does).
        if (state.lastScanAt == null) {
          ({ state } = await contentRescan({
            withCounts: true,
            includeZerok: prefs.probeZeroK,
          }));
        }
        const targets = targetsFromState(state);
        const target =
          targets.find((t) => targetKey(t) === selectedKey) ?? targets[0];
        if (!target) {
          setStartupState({ status: "done" });
          return;
        }
        await primeScan(target.enginePath, target.rootPath, force, opId);
        // Lists are ready now; thumbnails render in the background and must not
        // gate "done" or block the grid.
        setStartupState({ status: "done" });
        primeThumbnails(target.enginePath, target.rootPath).catch(() => {});
      } catch (e) {
        setStartupState({
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [prefs.probeZeroK, selectedKey],
  );

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!prefs.autoScanOnStartup) return;
    warmUp();
  }, [prefs.autoScanOnStartup, warmUp]);

  return (
    <>
      {startup.status === "scanning" && (
        <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-muted/40 px-4 py-2 text-sm">
          <span className="text-muted-foreground">Scanning content…</span>
          <Button variant="ghost" size="sm" onClick={cancelStartupScan}>
            Cancel
          </Button>
        </div>
      )}
      {startup.status === "error" && (
        <div className="flex items-center justify-between gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">
          <span className="break-words text-destructive">
            Content scan failed: {startup.error}
          </span>
          <Button variant="outline" size="sm" onClick={() => warmUp(true)}>
            Retry
          </Button>
        </div>
      )}
      {children}
    </>
  );
}
