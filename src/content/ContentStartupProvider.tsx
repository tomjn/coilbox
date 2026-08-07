import { useSetting } from "@picoframe/frame";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { useDownloadsConfig } from "../downloads/config";
import { contentRescan, contentStateLoad } from "./bindings";
import {
  primeMapMeta,
  primeScan,
  primeThumbnails,
  targetKey,
  targetsFromState,
  useContentPrefs,
} from "./config";
import { warmAllRoots } from "./rapidPoolWarm";

/**
 * App-launch warm-up for the Content plugin. Mounted as the plugin's `Provider`,
 * so this runs once at startup (before any route opens) rather than the first
 * time the Maps/Games pages are navigated to — the unitsync scan and the maps
 * grid thumbnails are then already in cache when the user arrives.
 *
 * The warm-up is deliberately headless: it renders no chrome of its own. Its
 * progress and failures surface *in context* on whichever content page the user
 * opens (the shared scan/error cache the pages read is the same one this fills),
 * so there's no global banner sitting above the app frame. A slow scan shows as
 * the page's own loading state, cancellable from its Rescan control; a failed
 * scan shows as that page's error banner.
 */
export default function ContentStartupProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [prefs] = useContentPrefs();
  const [selectedKey] = useSetting<string>("content.scanTarget", "");
  const [dlConfig, setDlConfig] = useDownloadsConfig();
  const ran = useRef(false);

  const warmUp = useCallback(async () => {
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
      // Lists are ready now; thumbnails render in the background and must not
      // gate the grid.
      primeThumbnails(target.enginePath, target.rootPath).catch(() => {});
      // Tier 3: mapinfo for every map, for the detail page and the singleplayer
      // map card. Behind the thumbnails because nothing on the grid needs it, and
      // fire-and-forget for the same reason.
      primeMapMeta(target.enginePath, target.rootPath).catch(() => {});
      // Warm the rapid pool (read `.sdp` manifests into the page cache) so the
      // engine's first rapid-tag resolution is warm. Fire-and-forget.
      warmAllRoots(state).catch(() => {});
    } catch {
      // The failure is recorded in the shared scan-error cache and surfaced by
      // the content page the user opens — nothing to show here.
    }
  }, [prefs.probeZeroK, selectedKey]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!prefs.autoScanOnStartup) return;
    warmUp();
  }, [prefs.autoScanOnStartup, warmUp]);

  // Back-fill the downloads write root on first run so the download
  // destination works without a trip to Downloads settings. Never overrides
  // a value the user (or a prior run of this effect) already set.
  useEffect(() => {
    if (dlConfig.writeRootId) return;
    contentStateLoad(undefined)
      .then(({ state }) => {
        const first = state.roots[0];
        if (first) setDlConfig({ ...dlConfig, writeRootId: first.id });
      })
      .catch(() => {});
  }, [dlConfig, setDlConfig]);

  return <>{children}</>;
}
