import { useEffect, useMemo, useState } from "react";
import { useDownloadsConfig, useWriteRootPath } from "../downloads/config";
import { useDownloadHistory } from "../downloads/downloadHistory";
import {
  loadRecoilEngines,
  loadSpringfilesEngines,
} from "../downloads/engineLists";
import {
  GAME_REPOS,
  type GameRepo,
  githubRepoForGame,
  mergeGameRepos,
} from "../downloads/gameRepos";
import { loadRapidTags, type RapidTag } from "../downloads/rapidTags";
import type { HubGame } from "../hub/api";
import { matchHubGame, useHubGames } from "../hub/gameIcons";
import { getProfile } from "../profile/profile";
import type { GameItem, ScanResult } from "./bindings";
import { loadGithubGameRepos } from "./branding";
import { useScanTargetSelection } from "./config";
import { useContentState } from "./contentState";
import { readLastScan } from "./lastScan";
import { countUpdates, engineUpdate } from "./updates";
import type { CatalogueRequest } from "./useLibrary";
import { useLibrary } from "./useLibrary";

/** Engine versions a game pins. Empty until #325's preferences exist. */
const PINNED_ENGINES: ReadonlySet<string> = new Set();

/**
 * The newest engine version listed that is newer than every installed engine,
 * or undefined. Reads the two engine lists through the session cache the
 * Engines settings page shares.
 */
export function useEngineUpdate(): string | undefined {
  const { state } = useContentState();
  const [lists, setLists] = useState<{
    recoil: { version: string; prerelease: boolean }[];
    springfiles: { version: string }[];
  }>({ recoil: [], springfiles: [] });
  useEffect(() => {
    let live = true;
    Promise.all([
      loadRecoilEngines().catch(() => undefined),
      loadSpringfilesEngines().catch(() => undefined),
    ]).then(([r, s]) => {
      if (live)
        setLists({ recoil: r?.releases ?? [], springfiles: s?.engines ?? [] });
    });
    return () => {
      live = false;
    };
  }, []);
  return useMemo(
    () =>
      engineUpdate({
        installed: (state?.roots ?? []).flatMap((r) => r.engines),
        ...lists,
        pinned: PINNED_ENGINES,
      }),
    [state, lists],
  );
}

/**
 * The GitHub repos to read releases from for the installed games: the one the
 * branding catalog or the built-in list names, and any the hub lists as a
 * download for that game. Only installed games, since each repo is a GitHub
 * request, and a game not yet installed is fetched from the hub's own list.
 */
export function installedGameRepos(
  games: readonly GameItem[],
  catalogRepos: GameRepo[],
  hubGames: readonly HubGame[] | null,
  skipRepo?: string,
): string[] {
  const repos = mergeGameRepos(catalogRepos, GAME_REPOS);
  const found = new Set<string>();
  for (const g of games) {
    const repo = githubRepoForGame(repos, g.name);
    if (repo) found.add(repo);
    for (const d of matchHubGame(hubGames, g.name, games)?.downloads ?? []) {
      if (d.kind === "github") found.add(d.value);
    }
  }
  if (skipRepo) found.delete(skipRepo);
  return [...found];
}

/**
 * What the library needs to judge updates for the games in `scan`: the GitHub
 * release lists of the installed games' repos, and where each rapid tag the
 * download history names points now. Reads the indexes the app already holds,
 * plus the rapid index copies on disk. `skipRepo` leaves one repo out.
 */
export function useUpdateSources(
  scan: Pick<ScanResult, "games"> | null,
  skipRepo?: string,
): {
  catalogues: CatalogueRequest[];
  rapidVersions: Record<string, RapidTag>;
} {
  const writePath = useWriteRootPath("games");
  const [cfg] = useDownloadsConfig();
  const history = useDownloadHistory();

  const [catalogRepos, setCatalogRepos] = useState<
    Awaited<ReturnType<typeof loadGithubGameRepos>>
  >([]);
  useEffect(() => {
    let live = true;
    loadGithubGameRepos().then(
      (r) => live && setCatalogRepos(r),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  const hubGames = useHubGames();
  const catalogues = useMemo(
    (): CatalogueRequest[] =>
      installedGameRepos(
        scan?.games ?? [],
        catalogRepos,
        hubGames,
        skipRepo,
      ).map((repo) => ({ source: "github", kind: "game", repo })),
    [scan, catalogRepos, hubGames, skipRepo],
  );

  const tags = useMemo(
    () =>
      [
        ...new Set(
          Object.values(history).flatMap((slots) =>
            Object.values(slots).flatMap((r) =>
              r.source === "rapid" && r.outcome === "ok" && r.reference
                ? [r.reference]
                : [],
            ),
          ),
        ),
      ].sort(),
    [history],
  );
  const masters = cfg.rapidRepos.map((r) => r.url).join("\n");
  const [rapidVersions, setRapidVersions] = useState<Record<string, RapidTag>>(
    {},
  );
  useEffect(() => {
    let live = true;
    loadRapidTags(tags, masters ? masters.split("\n") : [], writePath).then(
      (r) => live && setRapidVersions(r),
    );
    return () => {
      live = false;
    };
  }, [tags, masters, writePath]);

  return { catalogues, rapidVersions };
}

/**
 * Everything with a newer version available: rapid games, GitHub games and a
 * newer engine. It reads the indexes the app already fetches and holds, so it
 * adds no request of its own beyond reading the rapid index copies on disk.
 *
 * The profile's own game is left out of the GitHub check, because the game
 * updates plugin counts it from the same repo.
 */
export function useUpdates() {
  const { selected } = useScanTargetSelection();

  // The last saved scan, so the check never starts unitsync.
  const [scan, setScan] = useState<ScanResult | null>(null);
  const enginePath = selected?.enginePath;
  const rootPath = selected?.rootPath;
  useEffect(() => {
    if (!enginePath || !rootPath) return;
    let live = true;
    readLastScan(enginePath, rootPath).then((s) => {
      if (live) setScan(s);
    });
    return () => {
      live = false;
    };
  }, [enginePath, rootPath]);

  const { catalogues, rapidVersions } = useUpdateSources(
    scan,
    getProfile().release?.repo,
  );
  const library = useLibrary({ scan, catalogues, rapidVersions });
  const { games } = library;

  const engine = useEngineUpdate();

  const updated = useMemo(
    () => games.filter((g) => g.state === "update"),
    [games],
  );
  return {
    library,
    games: updated,
    engine,
    count: countUpdates({ games, engine }),
  };
}
