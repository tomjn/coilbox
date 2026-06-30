import { useSetting } from "@picoframe/frame";
import { type ReactNode, useEffect, useRef } from "react";
import { contentRescan, contentStateLoad } from "./bindings";
import {
  primeScan,
  primeThumbnails,
  targetKey,
  targetsFromState,
  useContentPrefs,
} from "./config";

/**
 * App-launch warm-up for the Content plugin. Mounted as the plugin's `Provider`,
 * so this runs once at startup (before any route opens) rather than the first
 * time the Maps/Games pages are navigated to — the unitsync scan and the maps
 * grid thumbnails are then already in cache when the user arrives.
 *
 * It mirrors the page selection: detect content folders on first run (same as the
 * Folders settings section), then scan the persisted target (or the first one)
 * and render its thumbnails. All best-effort and in the background — the pages
 * still scan and surface errors on demand if this is skipped or fails.
 */
export default function ContentStartupProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [prefs] = useContentPrefs();
  const [selectedKey] = useSetting<string>("content.scanTarget", "");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!prefs.autoScanOnStartup) return;

    (async () => {
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
        if (!target) return;
        await primeScan(target.enginePath, target.rootPath);
        await primeThumbnails(target.enginePath, target.rootPath);
      } catch (e) {
        console.error("content: launch warm-up failed", e);
      }
    })();
  }, [prefs.autoScanOnStartup, prefs.probeZeroK, selectedKey]);

  return <>{children}</>;
}
