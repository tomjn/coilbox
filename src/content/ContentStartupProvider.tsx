import { useSetting } from "@picoframe/frame";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { useDownloadsConfig } from "../downloads/config";
import { useTrustedHubUrl } from "../hub/config";
import { useSkirmishDraft } from "../play/drafts";
import { BundledEngineSetup } from "./BundledEngineSetup";
import { fetchListsInBackground } from "./backgroundFetch";
import { contentRescan } from "./bindings";
import {
  primeGameHeaders,
  primeGameInfo,
  primeMapMeta,
  primeScan,
  primeThumbnails,
  targetKey,
  targetsFromState,
  useContentPrefs,
} from "./config";
import { loadContentState, setContentState } from "./contentState";
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
  const hubUrl = useTrustedHubUrl();
  // The game the skirmish setup last held, which is the game the player last used.
  const [skirmish] = useSkirmishDraft();
  const ran = useRef(false);
  // The job starts after the first render, so it reads the settings as they are
  // then and not as they were when the effect was set up.
  const latest = useRef({ prefs, hubUrl, lastGame: skirmish.gameName });
  latest.current = { prefs, hubUrl, lastGame: skirmish.gameName };

  const fetchLists = useCallback(() => {
    const { prefs: now, hubUrl: hub } = latest.current;
    void fetchListsInBackground({
      enabled: now.fetchListsInBackground !== false,
      hubUrl: hub,
    });
  }, []);

  const warmUp = useCallback(async () => {
    try {
      let state = await loadContentState();
      // First run with no prior snapshot: detect standard data roots first, so
      // there's a target to scan (the same step the Folders section does).
      if (state.lastScanAt == null) {
        ({ state } = await contentRescan({
          withCounts: true,
          includeZerok: prefs.probeZeroK,
        }));
        setContentState(state);
      }
      // Warm the rapid pool (read `.sdp` manifests into the page cache) so the
      // engine's first rapid-tag resolution is warm. It needs only the state, so
      // it runs alongside the scan. Fire-and-forget.
      warmAllRoots(state).catch(() => {});
      const targets = targetsFromState(state);
      const target =
        targets.find((t) => targetKey(t) === selectedKey) ?? targets[0];
      if (!target) return;
      const { enginePath, rootPath } = target;
      const scan = await primeScan(enginePath, rootPath);
      // The rest runs after this returns, so the list fetch starts when the scan
      // is done. The steps run one after another so a read the user asks for
      // never waits behind more than one of them. The library worker takes the
      // first three and the page worker takes the game info.
      void (async () => {
        // Lists are ready now. The pictures render in the background and must
        // not gate the grid.
        await primeThumbnails(enginePath, rootPath).catch(() => {});
        // Tier 3: mapinfo for every map, for the detail page and the singleplayer
        // map card. Nothing on the grid needs it.
        await primeMapMeta(enginePath, rootPath).catch(() => {});
        await primeGameHeaders(enginePath, rootPath).catch(() => {});
        const last = scan.games.find((g) => g.name === latest.current.lastGame);
        if (last) {
          await primeGameInfo(
            enginePath,
            rootPath,
            last.primaryArchive.name,
          ).catch(() => {});
        }
      })();
    } catch {
      // The failure is recorded in the shared scan-error cache and surfaced by
      // the content page the user opens — nothing to show here.
    }
  }, [prefs.probeZeroK, selectedKey]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (prefs.autoScanOnStartup) {
      // The scan is what makes the first screen usable, so the lists wait for it.
      warmUp().then(fetchLists);
      return;
    }
    // With the scan off there is nothing to wait for, so wait for an idle moment.
    // WebKit has no requestIdleCallback, so a macrotask stands in there.
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(fetchLists);
    } else {
      setTimeout(fetchLists, 0);
    }
  }, [prefs.autoScanOnStartup, warmUp, fetchLists]);

  // Back-fill the downloads write root on first run so the download
  // destination works without a trip to Downloads settings. Never overrides
  // a value the user (or a prior run of this effect) already set.
  useEffect(() => {
    if (dlConfig.writeRootId) return;
    loadContentState()
      .then((state) => {
        // Never the bundled content folder, which coilbox does not write into.
        const first = state.roots.find((r) => !r.bundled);
        if (first) setDlConfig({ ...dlConfig, writeRootId: first.id });
      })
      .catch(() => {});
  }, [dlConfig, setDlConfig]);

  // The bundled engine copy starts here too, so it runs at launch whether or
  // not any page shows the setup card.
  return <BundledEngineSetup>{children}</BundledEngineSetup>;
}
