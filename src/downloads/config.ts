import { useSetting } from "@picoframe/frame";
import { useEffect, useState } from "react";
import { contentStateLoad } from "../content/bindings";

/** A user-configured rapid master. `url` is the base; `dl_repos` appends `/repos.gz`. */
export interface RapidRepo {
  id: string;
  name: string;
  url: string;
}

/**
 * The downloads plugin's config, persisted through the frame settings store
 * (Tauri-backed) under a single key — same pattern as uberstress. Holds the list
 * of selectable rapid masters and the content root downloads are written into.
 */
export interface DownloadsConfig {
  rapidRepos: RapidRepo[];
  /** Id of the content-plugin root downloads write into (`--filesystem-writepath`). */
  writeRootId?: string;
}

/** Spring + BAR rapid masters ship pre-configured; the user can add more. */
export const defaultConfig: DownloadsConfig = {
  rapidRepos: [
    { id: "spring", name: "Spring", url: "https://repos.springrts.com" },
    {
      id: "bar",
      name: "Beyond All Reason",
      url: "https://repos-cdn.beyondallreason.dev",
    },
  ],
};

export function useDownloadsConfig() {
  return useSetting<DownloadsConfig>("downloads.config", defaultConfig);
}

/**
 * All detected content-root paths. Used to detect already-installed content
 * across every folder (not just the write root) — e.g. a map present in a
 * skylobby data dir still counts as installed.
 */
export function useContentRootPaths(): string[] {
  const [paths, setPaths] = useState<string[]>([]);
  useEffect(() => {
    contentStateLoad(undefined)
      .then(({ state }) => setPaths(state.roots.map((r) => r.path)))
      .catch(() => setPaths([]));
  }, []);
  return paths;
}

/**
 * Resolve the configured write-root id (Downloads settings) to its on-disk path,
 * via the content plugin's detected roots. Shared by every download screen so
 * they all write into the same chosen folder. `undefined` when none is set or
 * the root no longer exists.
 */
export function useWriteRootPath(): string | undefined {
  const [cfg] = useDownloadsConfig();
  const [path, setPath] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!cfg.writeRootId) {
      setPath(undefined);
      return;
    }
    contentStateLoad(undefined)
      .then(({ state }) =>
        setPath(state.roots.find((r) => r.id === cfg.writeRootId)?.path),
      )
      .catch(() => setPath(undefined));
  }, [cfg.writeRootId]);
  return path;
}
