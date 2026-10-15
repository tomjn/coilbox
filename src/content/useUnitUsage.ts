import { useEffect, useMemo, useState } from "react";
import {
  contentReplayUnitOrders,
  type ReplayUnitOrders,
  type UnitDatasetEntry,
} from "./bindings";
import type { PlayerGame } from "./stats";
import { foldUnitUsage, replayLists, storedLists } from "./unitUsage";
import { useInstalledGames, useUnitListReads } from "./useUnitListReads";

/** What one call to Rust answered, and for which replays. */
interface Answer {
  key: string;
  replays: Map<string, ReplayUnitOrders>;
  lists: Map<string, UnitDatasetEntry[]>;
  failed: Set<string>;
  error: string | null;
}

/**
 * One player's unit orders over their games (#1167).
 *
 * One command call for the whole set: Rust walks each replay once and keeps
 * its totals on disk, so only the first visit after a new replay reads a demo.
 * A replay with no kept unit list is read against the game installed under its
 * exact name, with the match's own setup (#3847). A setup that changes nothing
 * about the game's unit list shares the game's one read, and any other costs a
 * read of its own, once. A replay that has a list costs none.
 *
 * Nothing is asked for until `wanted`.
 */
export function useUnitUsage(
  games: readonly PlayerGame[],
  playerName: string,
  wanted: boolean,
) {
  const { installed, enginePath, rootPath } = useInstalledGames();

  const pathsKey = games.map((g) => g.record.path).join("\n");
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (!wanted || !pathsKey) return;
    let live = true;
    contentReplayUnitOrders({ paths: pathsKey.split("\n") }).then(
      (got) => {
        if (!live) return;
        setAnswer({
          key: pathsKey,
          replays: new Map(got.replays.map((r) => [r.path, r])),
          lists: storedLists(got.sets),
          failed: new Set(got.failed.map((f) => f.path)),
          error: null,
        });
      },
      (e) => {
        if (!live) return;
        setAnswer({
          key: pathsKey,
          replays: new Map(),
          lists: new Map(),
          failed: new Set(),
          error: e instanceof Error ? e.message : String(e),
        });
      },
    );
    return () => {
      live = false;
    };
  }, [wanted, pathsKey]);

  const current = answer && answer.key === pathsKey ? answer : null;

  const datasets = useUnitListReads(
    current?.replays,
    current?.lists,
    installed,
    enginePath,
    rootPath,
  );

  const usage = useMemo(
    () =>
      foldUnitUsage(
        games,
        playerName,
        current?.replays ?? new Map(),
        current?.failed ?? new Set(),
        (replay) =>
          replayLists(replay, current?.lists ?? new Map(), installed, datasets),
      ),
    [games, playerName, current, installed, datasets],
  );

  return {
    usage,
    /** The call that reads the replays has not answered. */
    reading: wanted && pathsKey !== "" && !current,
    /** Why the replays could not be read at all, or null. */
    error: current?.error ?? null,
  };
}
