import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { errorText } from "@/lib/helpers";
import { useWriteRootPath } from "../downloads/config";
import {
  identityOf,
  useDownloadQueue,
} from "../downloads/DownloadQueueProvider";
import {
  downloadKey,
  hostOf,
  recordsFor,
  useDownloadHistory,
} from "../downloads/downloadHistory";
import { useGamePrefs } from "../downloads/gamePrefs";
import {
  GAME_REPOS,
  githubRepoForGame,
  mergeGameRepos,
} from "../downloads/gameRepos";
import { DEFAULT_RAPID_MASTERS } from "../downloads/rapidMasters";
import { refreshedLabel } from "../lib/relativeTime";
import type { ScanResult } from "./bindings";
import { useGithubGameRepos } from "./branding";
import { gameSourceRows } from "./gameSourceRows";
import { type GameVersionRow, gameVersionRows } from "./gameVersionRows";
import type { LibraryGame } from "./library";
import {
  gameKeys,
  gamePrefKey,
  installRequest,
  updateRequest,
} from "./libraryGames";
import { rapidReposOf, useGameRapidVersions } from "./useGameRapidVersions";
import { type CatalogueRequest, useLibrary } from "./useLibrary";
import { useUpdateSources } from "./useUpdates";

/**
 * Everything the game page's library parts need for the scanned game `name`
 * (issue #4580): its library record, where it was installed from, its versions
 * and its sources, the key its choices are stored under, and the downloads
 * the page starts.
 */
export function useGameLibrary(
  name: string,
  scan: Pick<ScanResult, "games" | "maps"> | null,
) {
  const { t } = useLingui();
  const writePath = useWriteRootPath("games");
  const history = useDownloadHistory();
  const prefs = useGamePrefs();
  const catalogRepos = useGithubGameRepos();
  const updateSources = useUpdateSources(scan);

  // The hub can name a GitHub repo the branding catalog does not, and its
  // releases are versions of this game too. Known only once the record is.
  const [hubRepos, setHubRepos] = useState<string[]>([]);
  const catalogues = useMemo(
    (): CatalogueRequest[] => [
      { source: "springfiles", kind: "game" },
      ...updateSources.catalogues,
      ...hubRepos
        .filter(
          (repo) =>
            !updateSources.catalogues.some(
              (c) => c.source === "github" && c.repo === repo,
            ),
        )
        .map((repo) => ({
          source: "github" as const,
          kind: "game" as const,
          repo,
        })),
    ],
    [updateSources.catalogues, hubRepos],
  );
  const library = useLibrary({
    scan,
    catalogues,
    rapidVersions: updateSources.rapidVersions,
  });
  const record = library.games.find((r) =>
    r.installed.some((g) => g.name === name),
  );
  const hubRepoKey = (record?.hub?.downloads ?? [])
    .flatMap((d) => (d.kind === "github" ? [d.value] : []))
    .join("\n");
  useEffect(() => {
    setHubRepos(hubRepoKey ? hubRepoKey.split("\n") : []);
  }, [hubRepoKey]);

  const repoNames = useMemo(
    () => rapidReposOf(record, history),
    [record, history],
  );
  const rapid = useGameRapidVersions(repoNames);

  const versions = useMemo(
    () =>
      record
        ? gameVersionRows(record, rapid.repos, writePath)
        : { rows: [], snapshots: [] },
    [record, rapid.repos, writePath],
  );

  const indexAge = useMemo(() => {
    if (rapid.repos.length === 0) return null;
    const age = Math.max(...rapid.repos.map((r) => r.ageSecs));
    const hosts = [
      ...new Set(rapid.repos.map((r) => hostOf(r.masterUrl) ?? r.masterUrl)),
    ].join(", ");
    const refreshed = refreshedLabel(age);
    return t`Rapid index ${refreshed} from ${hosts}`;
  }, [rapid.repos, t]);

  const catalogRepo = githubRepoForGame(
    mergeGameRepos(catalogRepos, GAME_REPOS),
    name,
  );
  const sources = useMemo(
    () =>
      record
        ? gameSourceRows({
            game: record,
            catalogRepo,
            masters: DEFAULT_RAPID_MASTERS,
            history,
            prefs,
          })
        : [],
    [record, catalogRepo, history, prefs],
  );

  const installedFrom = useMemo(
    () =>
      record
        ? (recordsFor(history, ...gameKeys(record)).find(
            (r) => r.outcome === "ok",
          ) ?? null)
        : null,
    [record, history],
  );

  const queue = useDownloadQueue();
  const [updating, setUpdating] = useState(false);
  const [updateFailure, setUpdateFailure] = useState<string | null>(null);
  /** Where a version row's download stands in the queue, or null. */
  const statusOf = (row: GameVersionRow) => {
    if (!row.request) return null;
    const status = queue.itemFor(identityOf(row.request))?.status;
    return status && status !== "canceled" ? status : null;
  };
  const install = (row: GameVersionRow) => {
    if (row.request) queue.enqueue(row.request);
  };
  const update = async () => {
    if (!record || !writePath) return;
    setUpdating(true);
    setUpdateFailure(null);
    try {
      queue.enqueue(await updateRequest(record, writePath));
    } catch (e) {
      setUpdateFailure(errorText(e));
    } finally {
      setUpdating(false);
    }
  };

  // A mutator the player does not have yet installs from the Mutators tab.
  const [installing, setInstalling] = useState<ReadonlySet<string>>(new Set());
  const [installFailures, setInstallFailures] = useState<
    Record<string, string>
  >({});
  const installGame = async (g: LibraryGame) => {
    if (!writePath) return;
    setInstalling((prev) => new Set(prev).add(g.id));
    setInstallFailures(({ [g.id]: _, ...rest }) => rest);
    try {
      queue.enqueue(await installRequest(g, writePath));
    } catch (e) {
      setInstallFailures((prev) => ({ ...prev, [g.id]: errorText(e) }));
    } finally {
      setInstalling((prev) => {
        const next = new Set(prev);
        next.delete(g.id);
        return next;
      });
    }
  };

  const prefKey = record ? gamePrefKey(record) : downloadKey("game", name);
  return {
    writePath,
    statusOf,
    install,
    update,
    installGame,
    installing,
    installFailures,
    updating,
    updateFailure,
    record,
    library,
    versions,
    indexAge,
    rapidLoading: rapid.loading,
    rapidErrors: rapid.errors,
    sources,
    installedFrom,
    prefKey,
    updatesOn: prefs[prefKey]?.updates !== false,
  };
}
