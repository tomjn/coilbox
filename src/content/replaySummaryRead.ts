import {
  contentDemoBuildOrders,
  contentReplayTrailer,
  contentUnitDefSet,
  type DemoBuildOrders,
  type DemoInfo,
  type Side,
  type UnitDatasetEntry,
} from "./bindings";
import { loadUnitsyncUnitDataset, primeGameInfo, primeScan } from "./config";
import { hubPickUnitIds } from "./hubPlayedFactions";
import {
  closestInstalledGame,
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

/** The game's sides, as `useRecordedGameSides` reads them, or null when they
 *  cannot be read. */
async function readSides(
  target: { dataDir: string; enginePath: string },
  info: DemoInfo,
): Promise<readonly Side[] | null> {
  const scan = await primeScan(target.enginePath, target.dataDir);
  const game = closestInstalledGame(recordedGame(info), scan.games);
  if (!game) return null;
  return primeGameInfo(
    target.enginePath,
    target.dataDir,
    game.primaryArchive.name,
  ).then(
    (read) => read.sides,
    () => null,
  );
}

export type SummaryRead =
  | { summary: ReplaySummary }
  | {
      problem: SummaryProblem | { kind: "otherBuild" } | { kind: "noSides" };
    };

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
  // A picked start unit needs the units and the game's sides to say which
  // faction it is.
  const picks = hubPickUnitIds(info.players);
  // A match with no build orders and no picked unit names no units, so nothing
  // is read for them.
  const units =
    orders.orders.length > 0 || picks.length > 0
      ? await readUnits(target, info, orders)
      : null;
  // Another version's ids can name the wrong unit, which the hub would refuse.
  if (units?.source.kind === "differentBuild") {
    return { problem: { kind: "otherBuild" } };
  }
  let sides: readonly Side[] = [];
  if (picks.length > 0) {
    const read = await readSides(target, info);
    // The hub would refuse a picked faction sent as none.
    if (!read) return { problem: { kind: "noSides" } };
    // Nobody is there to see that the units were not read, and to try again.
    if (!units?.described?.length) {
      return { problem: { kind: "unknownUnit", unitDefId: picks[0] } };
    }
    sides = read;
  }
  return buildReplaySummary(
    info,
    trailer,
    orders,
    units?.described ?? [],
    sides,
  );
}
