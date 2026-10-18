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
 * disk. Neither command is asked to refresh, so this is the copy the Browse
 * Rapid page reads, and a missing copy is fetched once as that page would.
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
    (async () => {
      const out: RapidRepoVersions[] = [];
      const errors: string[] = [];
      const left = new Set(names);
      for (const masterUrl of masters.split("\n")) {
        if (left.size === 0) break;
        try {
          const { repos: listed } = await dlRepos({ masterUrl });
          for (const r of listed) {
            if (!left.has(r.name)) continue;
            left.delete(r.name);
            try {
              const { versions, ageSecs } = await dlVersions({
                repoUrl: r.url,
                dataDir: writePath,
              });
              out.push({ repo: r.name, masterUrl, versions, ageSecs });
            } catch (e) {
              errors.push(`${r.name}: ${errorText(e)}`);
            }
          }
        } catch (e) {
          errors.push(`${masterUrl}: ${errorText(e)}`);
        }
      }
      if (live) setState({ repos: out, loading: false, errors });
    })();
    return () => {
      live = false;
    };
  }, [wanted, masters, writePath]);

  return state;
}
