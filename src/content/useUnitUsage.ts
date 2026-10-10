import { useEffect, useMemo, useState } from "react";
import {
  contentReplayUnitOrders,
  type GameItem,
  type ReplayUnitOrders,
  type UnitDatasetEntry,
} from "./bindings";
import {
  loadUnitsyncUnitDataset,
  useScanTargetSelection,
  useUnitsyncScan,
} from "./config";
import type { PlayerGame } from "./stats";
import {
  foldUnitUsage,
  replayLists,
  storedLists,
  streamNaming,
} from "./unitUsage";

/** One list, so a render with nothing installed does not look like a change. */
const NOTHING_INSTALLED: GameItem[] = [];

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
 * exact name, which is one unitsync read for each such game and none for a
 * replay that has a list.
 *
 * Nothing is asked for until `wanted`.
 */
export function useUnitUsage(
  games: readonly PlayerGame[],
  playerName: string,
  wanted: boolean,
) {
  const { selected } = useScanTargetSelection();
  const enginePath = selected?.enginePath;
  const rootPath = selected?.rootPath;
  const scan = useUnitsyncScan(enginePath, rootPath);
  // Null until the scan has answered. With no engine to scan with, or a scan
  // that failed, nothing is installed as far as naming goes.
  const installed =
    scan.data?.games ?? (scan.error || !selected ? NOTHING_INSTALLED : null);

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

  // The archives to read: each installed game a replay with no kept list is
  // named from. A string, so the effect depends on what it says.
  const archivesKey = useMemo(() => {
    if (!current || !installed) return "";
    const archives = new Set<string>();
    for (const replay of current.replays.values()) {
      const naming = streamNaming(replay, current.lists, installed);
      if (naming.kind === "installed") archives.add(naming.archive);
    }
    return [...archives].sort().join("\n");
  }, [current, installed]);

  // An archive maps to its units, or to null once its read has failed or come
  // back empty, so a read is tried once and "still reading" has an end.
  const [datasets, setDatasets] = useState<
    ReadonlyMap<string, UnitDatasetEntry[] | null>
  >(() => new Map());

  useEffect(() => {
    if (!archivesKey || !enginePath || !rootPath) return;
    let live = true;
    for (const archive of archivesKey.split("\n")) {
      const settle = (units: UnitDatasetEntry[] | null) => {
        if (live) setDatasets((before) => new Map(before).set(archive, units));
      };
      loadUnitsyncUnitDataset(enginePath, rootPath, archive).then(
        (dataset) => settle(dataset.units.length > 0 ? dataset.units : null),
        () => settle(null),
      );
    }
    return () => {
      live = false;
    };
  }, [archivesKey, enginePath, rootPath]);

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
