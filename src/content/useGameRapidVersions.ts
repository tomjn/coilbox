import { useEffect, useState } from "react";
import { errorText } from "@/lib/helpers";
import { dlRepos, dlVersions } from "../downloads/bindings";
import { useDownloadsConfig, useWriteRootPath } from "../downloads/config";
import { type DownloadHistory, recordsFor } from "../downloads/downloadHistory";
import type { RapidRepoVersions } from "./gameVersionRows";
import type { LibraryGame } from "./library";
import { gameKeys } from "./libraryGames";

/**
 * The rapid repositories a game is fetched from: the repo of each rapid tag the
 * hub names for it and of each tag it was installed from.
 */
export function rapidReposOf(
  game: LibraryGame | undefined,
  history: DownloadHistory,
): string[] {
  if (!game) return [];
  const tags = [
    ...(game.hub?.downloads ?? []).flatMap((d) =>
      d.kind === "rapid" ? [d.value] : [],
    ),
    ...recordsFor(history, ...gameKeys(game)).flatMap((r) =>
      r.source === "rapid" && r.reference?.includes(":") ? [r.reference] : [],
    ),
  ];
  return [...new Set(tags.map((t) => t.split(":")[0]))].sort();
}

/**
 * Every version in the game's rapid repositories, read from the index copies on
 * disk, which the Browse Rapid page reads too. A missing copy is fetched, and
 * a copy not fetched since the app started is shown and then fetched again.
 */
export function useGameRapidVersions(repos: readonly string[]): {
  repos: RapidRepoVersions[];
  loading: boolean;
  errors: string[];
} {
  const [cfg] = useDownloadsConfig();
  const writePath = useWriteRootPath("games");
  const masters = cfg.rapidRepos.map((r) => r.url).join("\n");
  const wanted = repos.join("\n");
  const [state, setState] = useState<{
    repos: RapidRepoVersions[];
    loading: boolean;
    errors: string[];
  }>({ repos: [], loading: false, errors: [] });

  useEffect(() => {
    const names = wanted ? wanted.split("\n") : [];
    if (names.length === 0 || !masters) {
      setState({ repos: [], loading: false, errors: [] });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    const read = async (revalidate: boolean) => {
      const out: RapidRepoVersions[] = [];
      const errors: string[] = [];
      let stale = false;
      const left = new Set(names);
      for (const masterUrl of masters.split("\n")) {
        if (left.size === 0) break;
        try {
          const listed = await dlRepos({ masterUrl, revalidate });
          stale ||= listed.stale;
          for (const r of listed.repos) {
            if (!left.has(r.name)) continue;
            left.delete(r.name);
            try {
              const index = await dlVersions({
                repoUrl: r.url,
                dataDir: writePath,
                revalidate,
              });
              stale ||= index.stale;
              out.push({
                repo: r.name,
                masterUrl,
                versions: index.versions,
                ageSecs: index.ageSecs,
              });
            } catch (e) {
              errors.push(`${r.name}: ${errorText(e)}`);
            }
          }
        } catch (e) {
          errors.push(`${masterUrl}: ${errorText(e)}`);
        }
      }
      return { state: { repos: out, loading: false, errors }, stale };
    };
    (async () => {
      const first = await read(false);
      if (!live) return;
      setState(first.state);
      // The disk copies show at once, then are fetched once this launch.
      if (!first.stale) return;
      const fresh = await read(true);
      if (live) setState(fresh.state);
    })();
    return () => {
      live = false;
    };
  }, [wanted, masters, writePath]);

  return state;
}
