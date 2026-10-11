import { useEffect, useMemo, useRef, useState } from "react";
import { heatGridSize } from "@/lib/heatField";
import {
  contentReplayMapGrids,
  contentReplayUnitOrders,
  type ReplayUnitOrders,
  type StoredUnitDef,
  type UnitDatasetEntry,
} from "./bindings";
import {
  type DefCategories,
  decodeReplayGrids,
  defCategories,
  MAP_GRID_RESOLUTION,
  type ReplayCounts,
} from "./mapAggregate";
import type { MapWorld } from "./replayMapLayers";
import { listMisfits, replayLists, storedLists } from "./unitUsage";
import { useInstalledGames, useUnitListReads } from "./useUnitListReads";

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

/** The orders read so far, by replay. Grows as the page's replays do. */
interface OrdersHeld {
  replays: Map<string, ReplayUnitOrders>;
  lists: Map<string, UnitDatasetEntry[]>;
  /** Replays Rust could not read, or whose call failed. */
  failed: Set<string>;
}

const NO_ORDERS: OrdersHeld = {
  replays: new Map(),
  lists: new Map(),
  failed: new Set(),
};

/**
 * What each replay's buildings are for, from the unit list that replay's own
 * page would name its orders from (#3904).
 *
 * A unit definition id means a unit in the list the engine built for one match,
 * and the list depends on the match's setup. So each replay is named from the
 * engine's own list when it was analysed, then from the game installed under
 * exactly the name it records, read with the replay's setup
 * (`streamNaming`). Replays of one game with one setup share a read
 * (`useUnitListReads`). A replay with no such list, or whose own orders do not
 * fit its list, gets no table and the category layers leave it out. The replay
 * page falls back to another version of the same game with a warning. A
 * picture of many matches has nowhere to put that warning per match, so it
 * does not.
 *
 * Nothing is asked of Rust or unitsync until `wanted`.
 */
export function useGameCategories(
  replays: readonly { path: string }[],
  wanted: boolean,
) {
  const { installed, enginePath, rootPath } = useInstalledGames();
  const [held, setHeld] = useState<OrdersHeld>(NO_ORDERS);
  const heldRef = useRef(held);
  heldRef.current = held;
  const pathsKey = replays.map((r) => r.path).join("\n");

  // Only the replays not read yet are asked for, so narrowing a filter asks
  // for nothing and a replay arriving does not read the others again.
  useEffect(() => {
    if (!wanted || !pathsKey) return;
    const have = heldRef.current;
    const missing = pathsKey
      .split("\n")
      .filter((p) => !have.replays.has(p) && !have.failed.has(p));
    if (missing.length === 0) return;
    let live = true;
    const merge = (
      got: {
        replays: ReplayUnitOrders[];
        sets: Record<string, StoredUnitDef[]>;
      },
      failed: string[],
    ) =>
      setHeld((before) => ({
        replays: new Map([
          ...before.replays,
          ...got.replays.map((r) => [r.path, r] as const),
        ]),
        lists: new Map([...before.lists, ...storedLists(got.sets)]),
        failed: new Set([...before.failed, ...failed]),
      }));
    contentReplayUnitOrders({ paths: missing }).then(
      (got) => {
        if (!live) return;
        const read = new Set(got.replays.map((r) => r.path));
        merge(
          got,
          missing.filter((p) => !read.has(p)),
        );
      },
      () => {
        if (live) merge({ replays: [], sets: {} }, missing);
      },
    );
    return () => {
      live = false;
    };
  }, [wanted, pathsKey]);

  const datasets = useUnitListReads(
    held.replays,
    held.lists,
    installed,
    enginePath,
    rootPath,
  );

  // Each replay's table, or why it has none.
  const verdicts = useMemo(() => {
    const tables = new Map<readonly UnitDatasetEntry[], DefCategories>();
    const out = new Map<
      string,
      DefCategories | "waiting" | "misfit" | "none"
    >();
    for (const path of pathsKey ? pathsKey.split("\n") : []) {
      const orders = held.replays.get(path);
      if (!orders) {
        // Not answered yet, or answered with a failure that cannot be checked.
        out.set(path, held.failed.has(path) ? "misfit" : "waiting");
        continue;
      }
      const { stream } = replayLists(orders, held.lists, installed, datasets);
      if (stream.kind !== "named") {
        out.set(path, stream.kind);
        continue;
      }
      if (listMisfits(orders, stream)) {
        out.set(path, "misfit");
        continue;
      }
      let table = tables.get(stream.units);
      if (!table) {
        table = defCategories(stream.units);
        tables.set(stream.units, table);
      }
      out.set(path, table);
    }
    return out;
  }, [pathsKey, held, installed, datasets]);

  return useMemo(() => {
    let misfit = 0;
    let waiting = false;
    for (const verdict of verdicts.values()) {
      if (verdict === "misfit") misfit++;
      else if (verdict === "waiting") waiting = true;
    }
    return {
      categories: (replay: { path: string }) => {
        const verdict = verdicts.get(replay.path);
        return typeof verdict === "object" ? verdict : undefined;
      },
      /** Replays whose orders do not fit their list, or could not be checked
       *  against it. They are in no category layer. */
      misfit,
      loading: wanted && (installed === null || waiting),
    };
  }, [verdicts, wanted, installed]);
}
