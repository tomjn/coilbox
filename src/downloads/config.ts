import { useSetting } from "@picoframe/frame";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ContentState } from "../content/bindings";
import { loadContentState, useContentState } from "../content/contentState";
import { readStoredSetting } from "../lib/storedSetting";
import { getProfileRoot } from "../profile/profile";
import { dlSetEngineDirs } from "./bindings";
import { DEFAULT_RAPID_MASTERS } from "./rapidMasters";
import {
  healWriteRoot,
  mutatorDataDir,
  packageDirOf,
  pickWriteRoot,
  type WriteRootKind,
} from "./writeRoot";

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
  /** Id of the root games go to instead. Unset means they follow `writeRootId`. */
  gamesRootId?: string;
  /** Id of the root maps go to instead. Unset means they follow `writeRootId`. */
  mapsRootId?: string;
}

/** The Spring rapid master ships pre-configured, and the user can add more. */
export const defaultConfig: DownloadsConfig = {
  rapidRepos: [...DEFAULT_RAPID_MASTERS],
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
  return useContentRoots().paths;
}

/**
 * The same paths, with the flag that says whether they have been read yet.
 *
 * `paths` is empty both before the read lands and on an install with no content
 * root at all, and a caller that acts on "the user has nothing installed" cannot
 * tell those apart from the array alone. Same distinction, and the same reason,
 * as {@link useWriteRoot}'s `loading` (issue #1099).
 */
export function useContentRoots(): { paths: string[]; loading: boolean } {
  const { state, error } = useContentState();
  return useMemo(
    () => ({
      paths: state?.roots.map((r) => r.path) ?? [],
      loading: state === null && error === null,
    }),
    [state, error],
  );
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
      const first = state.roots.find((r) => !r.bundled && !r.readOnly);
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
    loadContentState()
      .then((state) => {
        const dirs = Array.from(
          new Set(state.roots.flatMap((r) => r.engines.map((e) => e.path))),
        );
        return dlSetEngineDirs({ dirs });
      })
      .catch((e) => console.warn("engine-dirs: register failed", e));
  }, []);
}

/**
 * Where downloads go, and whether that has been read yet.
 *
 * The two travel together because resolving the path needs a disk read, so
 * `path` is `undefined` on the first render of every caller whatever the user
 * has configured. A caller that cannot tell that apart from "no folder is set"
 * says so on screen, and tells a configured user they have not set something
 * they have (issue #1099).
 */
export interface WriteRoot {
  /** The chosen folder, or `undefined` when there is none. */
  path?: string;
  /** True until the read lands, while `path` says nothing either way. */
  loading: boolean;
}

/**
 * Resolve the configured write-root id (Content folders settings) to its
 * on-disk path, via the content plugin's detected roots. Shared by every
 * download screen so they all write into the same chosen folder. `undefined`
 * when none is set or the root no longer exists.
 *
 * Pass `kind` for a game or a map, which can each have a folder of their own
 * and otherwise follow the default. Everything else, engines included, asks
 * with no kind and gets the default. See {@link pickWriteRoot}.
 *
 * A read that fails is `loading: false` with no path: the content plugin could
 * not name a single root, so there is nowhere to download to, which is the same
 * thing the user has to fix.
 *
 * In portable mode this also self-heals: if the configured root resolves outside the
 * package (e.g. a stale absolute root copied in from another install), it falls back
 * to an in-package root and persists that correction, so downloads can't silently
 * land next to the wrong folder. See {@link healWriteRoot}.
 */
export function useWriteRoot(kind?: WriteRootKind): WriteRoot {
  const [cfg, setCfg] = useDownloadsConfig();
  // Latest config for the heal-persist below, without re-running the load every
  // render (the effect keys on the writeRootId primitive, not the cfg object).
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const { state, error } = useContentState();
  const healed = useMemo(
    () =>
      state
        ? healWriteRoot(
            state.roots,
            cfg.writeRootId,
            packageDirOf(getProfileRoot()),
          )
        : undefined,
    [state, cfg.writeRootId],
  );
  // Persist the correction so downstream readers of `writeRootId` agree and the
  // stale id doesn't linger. One-shot: once the id matches, this stops firing.
  // Spread the latest config (via ref) so a concurrent rapid-repo edit isn't lost.
  useEffect(() => {
    if (healed && healed.id !== cfg.writeRootId) {
      setCfg({ ...cfgRef.current, writeRootId: healed.id });
    }
  }, [healed, cfg.writeRootId, setCfg]);
  const chosen = useMemo(
    () =>
      state
        ? pickWriteRoot(
            state.roots,
            {
              writeRootId: cfg.writeRootId,
              gamesRootId: cfg.gamesRootId,
              mapsRootId: cfg.mapsRootId,
            },
            kind,
            packageDirOf(getProfileRoot()),
          )
        : undefined,
    [state, cfg.writeRootId, cfg.gamesRootId, cfg.mapsRootId, kind],
  );
  // A later re-read (the heal above, or a settings change) does not go back to
  // loading. The previous answer stands until the new one lands, which is what
  // every caller already saw and is a definite answer either way.
  return useMemo(
    () => ({
      path: chosen?.path,
      loading: state === null && error === null,
    }),
    [chosen, state, error],
  );
}

/**
 * Just the path, for the callers that only offer a download and have no line to
 * put under it. They read `undefined` before the load lands exactly as they did
 * before {@link useWriteRoot} existed.
 */
export function useWriteRootPath(kind?: WriteRootKind): string | undefined {
  return useWriteRoot(kind).path;
}

// `useBarMap` lived here: BAR's maps-metadata list keyed by springName, read for
// a map's preview thumbnail, its size and its player count. Every one of those
// callers is gone, as part of coilbox retiring its use of BAR-hosted content.
// The list itself is still fetched by the Maps browse page, which lists it.

/**
 * Where a test mutator is written for an engine whose own folder is `dataDir`:
 * that folder, or the default write folder when coilbox may not write into it.
 * See {@link mutatorDataDir}.
 */
export async function resolveMutatorDataDir(dataDir: string): Promise<string> {
  try {
    const state = await loadContentState();
    const cfg = readStoredSetting<DownloadsConfig>(
      "downloads.config",
      defaultConfig,
    );
    const writeRoot = healWriteRoot(
      state.roots,
      cfg.writeRootId,
      packageDirOf(getProfileRoot()),
    );
    return mutatorDataDir(state.roots, dataDir, writeRoot?.path);
  } catch {
    // Without the folder list the engine's folder stands, and the write itself
    // is refused with the reason if that folder is read only.
    return dataDir;
  }
}
