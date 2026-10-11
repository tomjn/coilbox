import { useEffect, useMemo, useState } from "react";
import {
  contentReplayUnitOrders,
  type GameItem,
  type MatchSetup,
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

/** The archive and the setup a read's name holds (`StreamNaming.read`). */
function splitRead(read: string): [string, MatchSetup | undefined] {
  const at = read.indexOf("\n");
  return at < 0
    ? [read, undefined]
    : [read.slice(0, at), JSON.parse(read.slice(at + 1)) as MatchSetup];
}

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

  // The reads to make: one for each installed game and match setup a replay
  // with no kept list is named from. As text, so the effect depends on what it
  // says. A read's name holds its archive and its setup, so it is all the
  // effect needs.
  const readsKey = useMemo(() => {
    if (!current || !installed) return "";
    const reads = new Set<string>();
    for (const replay of current.replays.values()) {
      const naming = streamNaming(replay, current.lists, installed);
      if (naming.kind === "installed") reads.add(naming.read);
    }
    return JSON.stringify([...reads].sort());
  }, [current, installed]);

  // A read maps to its units, or to null once it has failed or come back
  // empty, so a read is tried once and "still reading" has an end.
  const [datasets, setDatasets] = useState<
    ReadonlyMap<string, UnitDatasetEntry[] | null>
  >(() => new Map());

  useEffect(() => {
    if (!readsKey || !enginePath || !rootPath) return;
    let live = true;
    // One after another. A setup that changes a game's unit list runs the
    // game's definitions again, and a player's games can hold many setups.
    void (async () => {
      for (const read of JSON.parse(readsKey) as string[]) {
        if (!live) return;
        const [archive, setup] = splitRead(read);
        const units = await loadUnitsyncUnitDataset(
          enginePath,
          rootPath,
          archive,
          setup,
        ).then(
          (dataset) => (dataset.units.length > 0 ? dataset.units : null),
          () => null,
        );
        if (live) setDatasets((before) => new Map(before).set(read, units));
      }
    })();
    return () => {
      live = false;
    };
  }, [readsKey, enginePath, rootPath]);

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
