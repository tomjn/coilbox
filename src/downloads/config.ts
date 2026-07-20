import { useSetting } from "@picoframe/frame";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentState } from "../content/bindings";
import { contentStateLoad } from "../content/bindings";
import { getProfileRoot } from "../profile/profile";
import { dlBarMaps, dlSetEngineDirs } from "./bindings";
import { healWriteRoot, packageDirOf } from "./writeRoot";

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
 * Returns a function that back-fills the download destination from a fresh
 * content state: if `writeRootId` is unset, it selects the first root. Call it
 * right after adding/creating a root so the destination is ready the same
 * session (the app-startup back-fill in ContentStartupProvider only covers roots
 * that already exist at launch). Never overrides a value already set.
 */
export function useDefaultWriteRoot(): (state: ContentState) => void {
  const [cfg, setCfg] = useDownloadsConfig();
  return useCallback(
    (state: ContentState) => {
      if (cfg.writeRootId) return;
      const first = state.roots[0];
      if (first) setCfg({ ...cfg, writeRootId: first.id });
    },
    [cfg, setCfg],
  );
}

/**
 * Register installed-engine directories with the downloads sidecar so it prefers
 * an engine's own pr-downloader (bundled with a complete, matched DLL set) over
 * coilbox's bootstrap copy. Loads engine dirs from content state at mount; an
 * engine installed later this session falls back to the bundled copy (which
 * works) until the next launch picks it up. Mounted app-wide via a plugin
 * Provider so it covers every download entrypoint (downloads pages + battle).
 */
export function useRegisterEngineDirs(): void {
  useEffect(() => {
    contentStateLoad(undefined)
      .then(({ state }) => {
        const dirs = Array.from(
          new Set(state.roots.flatMap((r) => r.engines.map((e) => e.path))),
        );
        return dlSetEngineDirs({ dirs });
      })
      .catch((e) => console.warn("engine-dirs: register failed", e));
  }, []);
}

/**
 * Resolve the configured write-root id (Downloads settings) to its on-disk path,
 * via the content plugin's detected roots. Shared by every download screen so
 * they all write into the same chosen folder. `undefined` when none is set or
 * the root no longer exists.
 *
 * In portable mode this also self-heals: if the configured root resolves outside the
 * package (e.g. a stale absolute root copied in from another install), it falls back
 * to an in-package root and persists that correction, so downloads can't silently
 * land next to the wrong folder. See {@link healWriteRoot}.
 */
export function useWriteRootPath(): string | undefined {
  const [cfg, setCfg] = useDownloadsConfig();
  // Latest config for the heal-persist below, without re-running the load every
  // render (the effect keys on the writeRootId primitive, not the cfg object).
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const [path, setPath] = useState<string | undefined>(undefined);
  useEffect(() => {
    contentStateLoad(undefined)
      .then(({ state }) => {
        const packageDir = packageDirOf(getProfileRoot());
        const chosen = healWriteRoot(state.roots, cfg.writeRootId, packageDir);
        setPath(chosen?.path);
        // Persist the correction so downstream readers of `writeRootId` agree and the
        // stale id doesn't linger. One-shot: once the id matches, this stops firing.
        // Spread the latest config (via ref) so a concurrent rapid-repo edit isn't lost.
        if (chosen && chosen.id !== cfg.writeRootId) {
          setCfg({ ...cfgRef.current, writeRootId: chosen.id });
        }
      })
      .catch(() => setPath(undefined));
  }, [cfg.writeRootId, setCfg]);
  return path;
}

// The BAR maps-metadata list keyed springName -> preview thumbnail URL, fetched
// once per session. The list is large and near-static, so we memoise the promise
// and share it across every caller; a failed load resets so a later mount retries.
let barPreviewsPromise: Promise<Map<string, string>> | null = null;
function loadBarMapPreviews(): Promise<Map<string, string>> {
  if (!barPreviewsPromise) {
    barPreviewsPromise = dlBarMaps(undefined)
      .then(({ maps }) => {
        const index = new Map<string, string>();
        for (const m of maps) {
          if (m.images?.preview) index.set(m.springName, m.images.preview);
        }
        return index;
      })
      .catch((e) => {
        barPreviewsPromise = null;
        throw e;
      });
  }
  return barPreviewsPromise;
}

/**
 * Resolve a map's remote preview thumbnail (BAR maps-metadata `images.preview`) by
 * springName, or `undefined` while loading or when the map isn't in the list. Used
 * as a fallback picture when a battle's map isn't installed and unitsync has no
 * local minimap to render. Pass `undefined` to skip the fetch entirely.
 */
export function useBarMapPreview(
  springName: string | undefined,
): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!springName) {
      setUrl(undefined);
      return;
    }
    let live = true;
    loadBarMapPreviews()
      .then((index) => {
        if (live) setUrl(index.get(springName));
      })
      .catch(() => {
        if (live) setUrl(undefined);
      });
    return () => {
      live = false;
    };
  }, [springName]);
  return url;
}
