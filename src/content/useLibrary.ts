import { useCallback, useEffect, useMemo, useState } from "react";
import { errorText } from "@/lib/helpers";
import { useContentRootPaths } from "../downloads/config";
import {
  useDownloadComplete,
  useDownloadQueue,
} from "../downloads/DownloadQueueProvider";
import { useDownloadHistory } from "../downloads/downloadHistory";
import { updatesOffKeys, useGamePrefs } from "../downloads/gamePrefs";
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
  /** What each rapid tag points at now, which a rapid game's update needs. */
  rapidVersions?: LibraryInput["rapidVersions"];
}

/** A mirror index that could not be read, and why. */
export interface CatalogueFailure {
  request: CatalogueRequest;
  reason: string;
}

/** The library record, and how far the disk listing behind it has got. */
export interface LibraryRecord extends Library {
  /**
   * A disk listing has landed, so `installedFiles` includes what is on disk.
   * False before the first read lands, and after a failed one with nothing
   * read before it. An unread listing looks exactly like an empty install.
   */
  filesRead: boolean;
  /** The disk has been asked and has answered, even if the read failed. */
  filesAnswered: boolean;
  /** Read the disk listing again. */
  refresh: () => Promise<void>;
  /** Every asked for mirror index has been read or has failed. */
  cataloguesRead: boolean;
  /** The mirror indexes that failed, which the merge leaves out. */
  catalogueFailures: CatalogueFailure[];
}

/**
 * The library record: one entry per game and per map, merging the scan, the
 * archives on disk, the hub games list, the mirror indexes and the download
 * queue (see {@link buildLibrary}). The only reader of `installedContent`. The
 * disk listing is read again whenever a download finishes.
 *
 * A failed read keeps the last listing. It is not a report that the player has
 * nothing, and dropping the listing would offer them every map they have.
 */
export function useLibrary({
  scan = null,
  catalogues = [],
  rapidVersions,
}: LibraryOptions = {}): LibraryRecord {
  const history = useDownloadHistory();
  const prefs = useGamePrefs();
  const updatesOff = useMemo(() => updatesOffKeys(prefs), [prefs]);
  const rootPaths = useContentRootPaths();
  const [files, setFiles] = useState<LibraryInput["files"]>(null);
  const [filesAnswered, setFilesAnswered] = useState(false);
  const readFiles = useCallback(async () => {
    if (rootPaths.length === 0) {
      setFiles(null);
      return;
    }
    try {
      setFiles(await installedContent({ paths: rootPaths }));
    } catch {
      // Leave the last listing in place.
    } finally {
      setFilesAnswered(true);
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
  const [failures, setFailures] = useState<CatalogueFailure[]>([]);
  const [readFor, setReadFor] = useState<readonly CatalogueRequest[] | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    Promise.allSettled(requests.map(loadCatalogue)).then((results) => {
      if (!live) return;
      setLoaded(
        results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
      );
      setFailures(
        results.flatMap((r, i) =>
          r.status === "rejected"
            ? [{ request: requests[i], reason: errorText(r.reason) }]
            : [],
        ),
      );
      setReadFor(requests);
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

  const library = useMemo(
    () =>
      buildLibrary({
        scan,
        files,
        hubGames,
        catalogues: loaded,
        queue,
        history,
        rapidVersions,
        updatesOff,
      }),
    [scan, files, hubGames, loaded, queue, history, rapidVersions, updatesOff],
  );
  return useMemo(
    () => ({
      ...library,
      filesRead: files !== null,
      filesAnswered,
      refresh: readFiles,
      cataloguesRead: readFor === requests,
      catalogueFailures: failures,
    }),
    [library, files, filesAnswered, readFiles, readFor, requests, failures],
  );
}
