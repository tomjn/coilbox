import { useCallback, useEffect, useMemo, useState } from "react";
import { useContentRootPaths } from "../downloads/config";
import {
  useDownloadComplete,
  useDownloadQueue,
} from "../downloads/DownloadQueueProvider";
import { loadGithubReleases } from "../downloads/githubReleases";
import {
  loadEvolutionRtsMaps,
  loadHakoraMaps,
  loadSpringfilesList,
} from "../downloads/mirrorIndex";
import { useHubGames } from "../hub/gameIcons";
import type { ScanResult } from "./bindings";
import { installedContent } from "./installedContent";
import {
  buildLibrary,
  type Library,
  type LibraryInput,
  type LoadedCatalogue,
} from "./library";

/** A mirror index for {@link useLibrary} to read and merge. */
export type CatalogueRequest =
  | { source: "springfiles"; kind: "map" | "game" }
  | { source: "hakora" }
  | { source: "evolutionrts" }
  | { source: "github"; kind: "map" | "game"; repo: string };

const requestKey = (c: CatalogueRequest) =>
  [c.source, "kind" in c ? c.kind : "map", "repo" in c ? c.repo : ""].join(":");

async function loadCatalogue(c: CatalogueRequest): Promise<LoadedCatalogue> {
  switch (c.source) {
    case "springfiles":
      return {
        ...c,
        entries: (await loadSpringfilesList(c.kind)).results,
      };
    case "hakora":
      return { ...c, entries: (await loadHakoraMaps()).maps };
    case "evolutionrts":
      return { ...c, entries: (await loadEvolutionRtsMaps()).maps };
    case "github":
      return { ...c, entries: await loadGithubReleases(c.repo) };
  }
}

export interface LibraryOptions {
  /** The scan the page already holds. */
  scan?: Pick<ScanResult, "games" | "maps"> | null;
  /**
   * The mirror indexes to merge. Each is read through the session cache the
   * download pages share, so asking for one a page already loads costs
   * nothing more. A read that fails is left out, and the page that asked for
   * the index says why.
   */
  catalogues?: readonly CatalogueRequest[];
}

/**
 * The library record: one entry per game and per map, merging the scan, the
 * archives on disk, the hub games list, the mirror indexes and the download
 * queue (see {@link buildLibrary}). The only reader of `installedContent`. The
 * disk listing is read again whenever a download finishes.
 */
export function useLibrary({
  scan = null,
  catalogues = [],
}: LibraryOptions = {}): Library {
  const rootPaths = useContentRootPaths();
  const [files, setFiles] = useState<LibraryInput["files"]>(null);
  const readFiles = useCallback(async () => {
    if (rootPaths.length === 0) {
      setFiles(null);
      return;
    }
    try {
      setFiles(await installedContent({ paths: rootPaths }));
    } catch {
      setFiles(null);
    }
  }, [rootPaths]);
  useEffect(() => {
    readFiles();
  }, [readFiles]);
  useDownloadComplete(() => {
    readFiles();
  });

  // Keyed by content, so a page passing a fresh array each render does not
  // read the indexes again.
  const wanted = catalogues.map(requestKey).join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `wanted` stands for `catalogues`
  const requests = useMemo(() => catalogues, [wanted]);
  const [loaded, setLoaded] = useState<LoadedCatalogue[]>([]);
  useEffect(() => {
    let live = true;
    Promise.allSettled(requests.map(loadCatalogue)).then((results) => {
      if (!live) return;
      setLoaded(
        results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
      );
    });
    return () => {
      live = false;
    };
  }, [requests]);

  const hubGames = useHubGames();
  // Rebuilt when an item changes state, not on every progress event.
  const { items } = useDownloadQueue();
  const queueKey = items
    .map((i) => `${i.id}:${i.status}:${i.error ?? ""}`)
    .join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `queueKey` stands for `items`
  const queue = useMemo(() => items, [queueKey]);

  return useMemo(
    () =>
      buildLibrary({
        scan,
        files,
        hubGames,
        catalogues: loaded,
        queue,
      }),
    [scan, files, hubGames, loaded, queue],
  );
}
