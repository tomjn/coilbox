/**
 * The asynchronous half of the content card-art source (issue #989).
 *
 * {@link ./contentArt} decides what each tool should picture and holds the cache
 * the chain reads. This turns those picks into URLs and publishes them, and it
 * is the only file in the pair that talks to unitsync or to React.
 *
 * They are separate files because `art.ts` registers the source, so anything
 * `contentArt.ts` imports lands in the import graph of every test that touches
 * the chain. Keeping the IPC and the hooks on this side is what lets the chain
 * stay a pure function that unit tests without a DOM or a Tauri bridge, which is
 * the property `art.ts` was built around.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useCampaignProgress, useCampaigns } from "../campaign/campaigns";
import { type MinimapResult, unitsyncMinimap } from "../content/bindings";
import {
  useReplays,
  useScanTargetSelection,
  useUnitsyncGameHeaders,
} from "../content/config";
import { unitsyncThumbUrl } from "../lib/assetUrl";
import { useSkirmishDraft } from "../play/drafts";
import { useRuns } from "../runlite/runs";
import { useScenarios } from "../scenario/scenarios";
import {
  type ContentPick,
  contentArtVersion,
  contentPicks,
  picksKey,
  publishContentArt,
  resumeRunId,
  subscribeContentArt,
} from "./contentArt";
import { useResume } from "./continue";

/** Session cache of resolved minimap URLs, keyed by root, engine and map. */
const minimapUrls = new Map<string, string | null>();

/** The mip the maps grid renders at, so both share one disk-cache entry. */
const CARD_MIP = 3;

/** Drop the resolved-minimap memo, so the next resolve re-renders. For tests. */
export function resetResolvedMinimaps(): void {
  minimapUrls.clear();
}

/** The worker's answer as one URL: the cached file where it reached disk. */
function renderedUrl(res: MinimapResult): string | null {
  if (res.file) return unitsyncThumbUrl(res.file);
  return res.dataUrl ?? null;
}

/**
 * Resolve one map's minimap to a URL, once per target per session.
 *
 * Rendered at {@link CARD_MIP} through the same command the map detail page
 * uses, so a map already rendered for the maps grid costs one worker launch and
 * no rendering at all. A map that is not installed, or whose archive will not
 * open, caches its failure as `null` so a broken map is not retried on every
 * home visit.
 */
async function minimapUrl(
  enginePath: string,
  dataDir: string,
  mapName: string,
): Promise<string | null> {
  const key = `${dataDir}::${enginePath}::${mapName}`;
  const cached = minimapUrls.get(key);
  if (cached !== undefined) return cached;
  let url: string | null = null;
  try {
    const res = await unitsyncMinimap({
      enginePath,
      dataDir,
      mapName,
      mip: CARD_MIP,
    });
    url = renderedUrl(res);
  } catch {
    url = null;
  }
  minimapUrls.set(key, url);
  return url;
}

/**
 * Resolve every pick to a URL.
 *
 * Maps are resolved one at a time rather than in parallel. Each one launches a
 * unitsync worker process that mounts an archive, and three of those at once on
 * a page the user is trying to read is worse than the art arriving a beat later.
 * Distinct maps only, so two cards on the same map share one render.
 *
 * A pick that resolves to nothing is left out of the result rather than mapped
 * to an empty string, because the chain reads an empty string as an answer and a
 * missing key as a fall-through.
 */
export async function resolvePicks(
  picks: ReadonlyMap<string, ContentPick>,
  enginePath: string,
  dataDir: string,
  headers: ReadonlyMap<string, string>,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const maps = new Map<string, string | null>();
  for (const [toolId, pick] of picks) {
    if (pick.kind === "game") {
      const url = headers.get(pick.gameName);
      if (url) resolved.set(toolId, url);
      continue;
    }
    if (!maps.has(pick.mapName)) {
      maps.set(
        pick.mapName,
        await minimapUrl(enginePath, dataDir, pick.mapName),
      );
    }
    const url = maps.get(pick.mapName);
    if (url) resolved.set(toolId, url);
  }
  return resolved;
}

/**
 * Keep the content art up to date, and re-render when it changes.
 *
 * Mounted once by `CoilboxHome`, above the layout, because publishing has to
 * re-render the cards and a card cannot re-render itself off a module cache.
 * Returns nothing. The answer reaches the cards through the chain, not through a
 * prop.
 *
 * Every store read here is one another home zone already mounts, or one cheap
 * listing, so the added cost of the home page knowing what you played is the
 * minimap renders themselves, and those are cached on disk across launches.
 */
export function useContentCardArt(): void {
  useSyncExternalStore(
    subscribeContentArt,
    contentArtVersion,
    contentArtVersion,
  );

  const { selected } = useScanTargetSelection();
  const [draft] = useSkirmishDraft();
  const { replays } = useReplays(selected?.rootPath);
  const { campaigns } = useCampaigns();
  const { progress } = useCampaignProgress();
  const { scenarios } = useScenarios();
  const { runs } = useRuns();
  const { candidates } = useResume();
  const { headers } = useUnitsyncGameHeaders(
    selected?.enginePath,
    selected?.rootPath,
  );

  const picks = contentPicks({
    draft,
    replays,
    campaigns,
    progress,
    scenarios,
    runs,
    resumeRunId: resumeRunId(candidates),
  });

  // The picks are rebuilt on every render, so the effect depends on their value
  // through `key` rather than on the Map's identity, which would re-run it
  // forever. The ref is how the effect then reads the value that key describes.
  const key = picksKey(picks);
  const picksRef = useRef(picks);
  picksRef.current = picks;
  const enginePath = selected?.enginePath;
  const dataDir = selected?.rootPath;

  useEffect(() => {
    if (!enginePath || !dataDir || !key) return;
    let cancelled = false;
    resolvePicks(picksRef.current, enginePath, dataDir, headers)
      .then((resolved) => {
        if (!cancelled) publishContentArt(resolved);
      })
      .catch(() => {
        // A failed resolve leaves the previous answer in place. Every card has a
        // floor below it, so there is nothing to report and nothing to clear.
      });
    return () => {
      cancelled = true;
    };
  }, [key, enginePath, dataDir, headers]);
}
