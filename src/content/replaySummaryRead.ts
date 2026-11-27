import {
  contentDemoBuildOrders,
  contentReplayTrailer,
  contentUnitDefSet,
  type DemoBuildOrders,
  type DemoInfo,
  type UnitDatasetEntry,
} from "./bindings";
import { loadUnitsyncUnitDataset, primeScan } from "./config";
import {
  liveGame,
  pickUnitSource,
  recordedGame,
  sourceUnits,
  type UnitSource,
} from "./replayBuildOrders";
import {
  buildReplaySummary,
  type ReplaySummary,
  type SummaryProblem,
} from "./replaySummary";
import { namedUnits, storedListFor } from "./replayUnitDefs";

/**
 * The reads the summary is made of, outside a component, for a send nobody has
 * a replay page open for (issue #5494). The page makes the same reads through
 * its hooks, and both pick a unit list and build the summary with the same
 * functions.
 */

/** The units a replay's build orders name, as `useReplayUnits` reads them for
 *  stream ids. */
async function readUnits(
  target: { dataDir: string; enginePath: string },
  info: DemoInfo,
  orders: DemoBuildOrders,
): Promise<{
  source: UnitSource;
  described: UnitDatasetEntry[] | null;
}> {
  const scan = await primeScan(target.enginePath, target.dataDir);
  // A store that cannot be read counts as nothing kept, as it does on the page.
  const sets = info.gameId
    ? await contentUnitDefSet({ gameId: info.gameId }).catch(() => null)
    : null;
  const source = pickUnitSource(
    recordedGame(info),
    scan.games,
    storedListFor(sets, "stream"),
    orders.unitNames,
  );
  const archive = liveGame(source)?.primaryArchive.name;
  // Another version's ids are refused below, so its units are not worth a read.
  const reading =
    archive && source.kind !== "differentBuild"
      ? loadUnitsyncUnitDataset(
          target.enginePath,
          target.dataDir,
          archive,
          source.kind === "installed" ? info.matchSetup : undefined,
        )
      : null;
  // A failed read leaves no units, and the summary says which one it lacks.
  const read = (await reading?.catch(() => null))?.units ?? null;
  const named =
    source.kind === "replay" ? namedUnits(source.names, read ?? []) : null;
  return { source, described: sourceUnits(source, read, named).described };
}

export type SummaryRead =
  | { summary: ReplaySummary }
  | { problem: SummaryProblem | { kind: "otherBuild" } };

/** Read a replay and build its summary. Rejects when the file cannot be read. */
export async function readReplaySummary(
  target: { dataDir: string; enginePath: string },
  replayPath: string,
  info: DemoInfo,
): Promise<SummaryRead> {
  const [{ trailer }, orders] = await Promise.all([
    contentReplayTrailer({ replayPath }),
    contentDemoBuildOrders({ replayPath }),
  ]);
  // A match with no build orders names no units, so nothing is read for them.
  const units =
    orders.orders.length > 0 ? await readUnits(target, info, orders) : null;
  // Another version's ids can name the wrong unit, which the hub would refuse.
  if (units?.source.kind === "differentBuild") {
    return { problem: { kind: "otherBuild" } };
  }
  return buildReplaySummary(info, trailer, orders, units?.described ?? []);
}
