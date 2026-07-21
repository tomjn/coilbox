import { Channel } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { primeScan, useScanTargetSelection } from "../content/config";
import {
  type DownloadProgress,
  dlDownloadFile,
  dlInstalledContent,
} from "../downloads/bindings";
import { useContentRootPaths, useWriteRootPath } from "../downloads/config";
import { notify } from "../notify/notify";
import { getProfile, getProfileRoot } from "../profile/profile";
import { dlGithubLatestRelease, type ReleaseInfo } from "./bindings";

/** True for a game archive (`.sdz`/`.sd7`) release asset. */
function isArchive(name: string): boolean {
  return /\.(sdz|sd7)$/i.test(name);
}

/** The distribution profile's bundled-profile asset, by convention. */
const PROFILE_ASSET = "profile.json";

interface GameUpdatesContextValue {
  /** The profile's update repo ("owner/name"), or null when unset. */
  repo: string | null;
  /** The latest release, once fetched. */
  release: ReleaseInfo | null;
  checking: boolean;
  error: string | null;
  /** A newer game archive is available (release archive not yet installed). */
  updateAvailable: boolean;
  installing: boolean;
  /** Install of the current release finished this session. */
  installed: boolean;
  /** The release also carried an updated profile.json — restart to apply it. */
  profileUpdated: boolean;
  /** Filename currently downloading, for the progress label. */
  currentFile: string | null;
  progress: DownloadProgress | null;
  runCheck: () => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
}

const GameUpdatesContext = createContext<GameUpdatesContextValue | null>(null);

/** Access game-updates state. Must be used within <GameUpdatesProvider>. */
export function useGameUpdates(): GameUpdatesContextValue {
  const ctx = useContext(GameUpdatesContext);
  if (!ctx)
    throw new Error("useGameUpdates must be used within GameUpdatesProvider");
  return ctx;
}

export function GameUpdatesProvider({ children }: { children: ReactNode }) {
  const repo = getProfile().release?.repo ?? null;
  const writePath = useWriteRootPath();
  const rootPaths = useContentRootPaths();
  const { selected } = useScanTargetSelection();

  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installedGames, setInstalledGames] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [profileUpdated, setProfileUpdated] = useState(false);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  // Lowercased game filenames present in any content root, for the "have we got
  // this release?" check. Mirrors the Games download screen.
  const refreshInstalled = useCallback(async () => {
    if (!repo || rootPaths.length === 0) {
      setInstalledGames(new Set());
      return;
    }
    try {
      const { games } = await dlInstalledContent({ paths: rootPaths });
      setInstalledGames(new Set(games));
    } catch {
      setInstalledGames(new Set());
    }
  }, [repo, rootPaths]);

  useEffect(() => {
    refreshInstalled();
  }, [refreshInstalled]);

  const runCheck = useCallback(async () => {
    if (!repo) return;
    setChecking(true);
    setError(null);
    try {
      setRelease(await dlGithubLatestRelease({ repo }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }, [repo]);

  // One background check on launch when the profile names a repo.
  useEffect(() => {
    if (repo) void runCheck();
  }, [repo, runCheck]);

  // We have the release iff at least one of its game archives is already installed.
  const updateAvailable = useMemo(() => {
    if (!release) return false;
    const archives = release.assets.filter((a) => isArchive(a.name));
    if (archives.length === 0) return false;
    return !archives.some((a) => installedGames.has(a.name.toLowerCase()));
  }, [release, installedGames]);

  const notifiedRef = useRef(false);
  useEffect(() => {
    if (updateAvailable && !notifiedRef.current) {
      notifiedRef.current = true;
      void notify({
        title: "Game update available",
        body: "A newer game version is available to download.",
        level: "info",
        to: "/settings/game-updates",
      });
    }
    if (!updateAvailable) notifiedRef.current = false;
  }, [updateAvailable]);

  const install = useCallback(async () => {
    if (!release || !writePath) return;
    setInstalling(true);
    setInstalled(false);
    setError(null);
    setProgress(null);
    try {
      // Download every game archive we don't already have into <writeRoot>/games.
      const archives = release.assets.filter(
        (a) => isArchive(a.name) && !installedGames.has(a.name.toLowerCase()),
      );
      for (const asset of archives) {
        setCurrentFile(asset.name);
        const onProgress = new Channel<DownloadProgress>();
        onProgress.onmessage = (p) => setProgress(p);
        await dlDownloadFile({
          url: asset.url,
          destDir: `${writePath}/games`,
          filename: asset.name,
          onProgress,
        });
      }

      // If the release ships an updated profile.json, drop it into the portable
      // .coilbox folder. It only takes effect on the next launch.
      const profileAsset = release.assets.find((a) => a.name === PROFILE_ASSET);
      const profileRoot = getProfileRoot();
      if (profileAsset && profileRoot) {
        setCurrentFile(profileAsset.name);
        const onProgress = new Channel<DownloadProgress>();
        onProgress.onmessage = (p) => setProgress(p);
        await dlDownloadFile({
          url: profileAsset.url,
          destDir: profileRoot,
          filename: PROFILE_ASSET,
          onProgress,
        });
        setProfileUpdated(true);
      }

      // Make the new archive visible without a restart: refresh the installed set
      // and force a unitsync rescan of the write root with the selected engine.
      await refreshInstalled();
      if (selected) {
        await primeScan(selected.enginePath, writePath, true).catch(() => {});
      }
      setInstalled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
      setCurrentFile(null);
      setProgress(null);
    }
  }, [release, writePath, installedGames, refreshInstalled, selected]);

  const restart = useCallback(() => relaunch(), []);

  return (
    <GameUpdatesContext.Provider
      value={{
        repo,
        release,
        checking,
        error,
        updateAvailable,
        installing,
        installed,
        profileUpdated,
        currentFile,
        progress,
        runCheck,
        install,
        restart,
      }}
    >
      {children}
    </GameUpdatesContext.Provider>
  );
}
