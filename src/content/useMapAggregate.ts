import { useEffect, useMemo, useState } from "react";
import { heatGridSize } from "@/lib/heatField";
import { contentReplayMapGrids } from "./bindings";
import {
  loadUnitsyncUnitDataset,
  useScanTargetSelection,
  useUnitsyncScan,
} from "./config";
import {
  type DefCategories,
  decodeReplayGrids,
  defCategories,
  MAP_GRID_RESOLUTION,
  type ReplayCounts,
} from "./mapAggregate";
import { pickUnitSource } from "./replayBuildOrders";
import type { MapWorld } from "./replayMapLayers";

/** One replay to read, and what would make an earlier read of it stale. */
export interface ReplayAsk {
  path: string;
  /** When the match's stored analysis was written, or 0 with none. A read
   *  made before an analysis landed has no deaths in it. */
  analysedAtMs: number;
}

/**
 * The counts read this session, by replay, map size and analysis. Held outside
 * React so the typed arrays are never a prop or a piece of state, and so
 * coming back to a map's page reads nothing again. Rust keeps the same counts
 * on disk, so this only saves the round trip.
 */
const held = new Map<string, ReplayCounts>();
const refused = new Map<string, string>();

const keyOf = (ask: ReplayAsk, world: MapWorld) =>
  `${world.worldWidth}x${world.worldHeight}|${ask.analysedAtMs}|${ask.path}`;

/** Forget every read. For tests. */
export function resetMapReplayCounts(): void {
  held.clear();
  refused.clear();
}

/**
 * Each replay's counts on this map's grid, read one at a time.
 *
 * One command call a replay, so the page can show how far it has got and draw
 * what has arrived. A long first read of a large library is walked in Rust,
 * off the interface's thread. Leaving the page stops the reads after the one
 * in flight.
 */
export function useMapReplayCounts(
  asks: readonly ReplayAsk[],
  world: MapWorld,
) {
  const [tick, setTick] = useState(0);
  const sized = world.worldWidth > 0 && world.worldHeight > 0;
  const asksKey = asks.map((a) => `${a.analysedAtMs}|${a.path}`).join("\n");

  // biome-ignore lint/correctness/useExhaustiveDependencies: asksKey stands for asks, whose identity changes every render
  useEffect(() => {
    if (!sized) return;
    let live = true;
    const want = heatGridSize(
      world.worldWidth,
      world.worldHeight,
      MAP_GRID_RESOLUTION,
    );
    (async () => {
      for (const ask of asks) {
        if (!live) return;
        const key = keyOf(ask, world);
        if (held.has(key) || refused.has(key)) continue;
        try {
          const answer = await contentReplayMapGrids({
            paths: [ask.path],
            worldWidth: world.worldWidth,
            worldHeight: world.worldHeight,
          });
          // Counts on another grid would land in the wrong cells, and nothing
          // about the picture would say so.
          if (
            answer.grid.width !== want.width ||
            answer.grid.height !== want.height
          )
            throw new Error("the counts are not on this map's grid");
          const [raw] = answer.replays;
          if (raw) held.set(key, decodeReplayGrids(raw));
          else
            refused.set(
              key,
              answer.failed[0]?.error ?? "the replay was not read",
            );
        } catch (e) {
          refused.set(key, e instanceof Error ? e.message : String(e));
        }
        if (live) setTick((t) => t + 1);
      }
    })();
    return () => {
      live = false;
    };
  }, [asksKey, sized, world.worldWidth, world.worldHeight]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is what says a read landed, and asksKey stands for asks
  return useMemo(() => {
    const counts = new Map<string, ReplayCounts>();
    const failed: { path: string; error: string }[] = [];
    for (const ask of asks) {
      const key = keyOf(ask, world);
      const hit = held.get(key);
      if (hit) counts.set(ask.path, hit);
      else {
        const error = refused.get(key);
        if (error !== undefined) failed.push({ path: ask.path, error });
      }
    }
    return {
      /** By replay path. The same map until a read lands or the asks change. */
      counts,
      failed,
      done: counts.size + failed.length,
      total: asks.length,
      reading: sized && counts.size + failed.length < asks.length,
    };
  }, [tick, asksKey, sized, world.worldWidth, world.worldHeight]);
}

/**
 * What each building is for, by the game and version a replay names.
 *
 * A unit definition id means a unit in one build of one game and nothing in
 * any other, so a table is only made from the build installed under exactly
 * the name the replay records. A replay of a build that is not installed gets
 * no table, and the category layers leave it out and say so. The replay page
 * falls back to another version of the same game with a warning. A picture of
 * many matches has nowhere to put that warning per match, so it does not.
 *
 * Nothing is asked of unitsync until `wanted`.
 */
export function useGameCategories(
  gameTypes: readonly string[],
  wanted: boolean,
) {
  const { selected } = useScanTargetSelection();
  const scan = useUnitsyncScan(selected?.enginePath, selected?.rootPath);
  // A game type maps to its table, or to null once its read has failed or
  // come back empty, so a read is tried once and "still reading" has an end.
  const [tables, setTables] = useState<
    ReadonlyMap<string, DefCategories | null>
  >(() => new Map());
  const games = scan.data?.games;
  const enginePath = selected?.enginePath;
  const rootPath = selected?.rootPath;

  // The archive to read for each game type that is installed under its exact
  // name. A string, so the effect depends on what it says and not on the
  // identity of the scan's list.
  const wantedKey = useMemo(() => {
    if (!wanted || !games) return "";
    return [...new Set(gameTypes)]
      .sort()
      .flatMap((gameType) => {
        const source = pickUnitSource(gameType, games);
        return source.kind === "installed"
          ? [`${gameType}\t${source.game.primaryArchive.name}`]
          : [];
      })
      .join("\n");
  }, [wanted, games, gameTypes]);

  useEffect(() => {
    if (!wantedKey || !enginePath || !rootPath) return;
    let live = true;
    for (const line of wantedKey.split("\n")) {
      const [gameType, archive] = line.split("\t");
      const settle = (table: DefCategories | null) => {
        if (live) setTables((before) => new Map(before).set(gameType, table));
      };
      loadUnitsyncUnitDataset(enginePath, rootPath, archive).then(
        (dataset) =>
          settle(
            dataset.units.length > 0 ? defCategories(dataset.units) : null,
          ),
        () => settle(null),
      );
    }
    return () => {
      live = false;
    };
  }, [wantedKey, enginePath, rootPath]);

  return useMemo(() => {
    const asked = wantedKey
      ? wantedKey.split("\n").map((l) => l.split("\t")[0])
      : [];
    return {
      categories: (gameType: string) => tables.get(gameType) ?? undefined,
      loading: (wanted && scan.loading) || asked.some((g) => !tables.has(g)),
    };
  }, [tables, wantedKey, wanted, scan.loading]);
}
