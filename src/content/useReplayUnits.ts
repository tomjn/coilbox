import { useEffect, useState, useSyncExternalStore } from "react";
import {
  type BuildOrder,
  contentUnitDefSet,
  contentUnitDefSetStore,
  type DemoInfo,
  type GameItem,
  type ReplayUnitDefSets,
  type UnitDatasetEntry,
  type UnitDefLink,
} from "./bindings";
import {
  useScanTargetSelection,
  useUnitsyncScan,
  useUnitsyncUnitDataset,
} from "./config";
import {
  isLooseFolder,
  liveGame,
  pickUnitSource,
  pictureGame,
  recordedGame,
  type UnitSource,
} from "./replayBuildOrders";
import {
  misfits,
  orderFit,
  storedListFor,
  type UnitIds,
  unitToStored,
} from "./replayUnitDefs";

/**
 * What the unit definition store holds for each replay looked at this session,
 * by game id. A replay's lists change only when this app records one, which
 * goes through `forget` below, so an answer is good until then.
 */
const kept = new Map<string, ReplayUnitDefSets | null>();
const pending = new Map<string, Promise<ReplayUnitDefSets | null>>();
/** Replays a list has been handed over for, so it is handed over once. */
const handedOver = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Drop what is remembered for a replay, so the next reader asks again. */
function forget(gameId: string) {
  kept.delete(gameId);
  pending.delete(gameId);
  version++;
  for (const listener of listeners) listener();
}

/**
 * Ask the store what it holds for a replay. A failure reads as nothing kept:
 * the store only ever adds a source of names, so a replay with none is read
 * the way it was before there was a store.
 */
function readKept(gameId: string): Promise<ReplayUnitDefSets | null> {
  let asked = pending.get(gameId);
  if (!asked) {
    asked = Promise.resolve()
      .then(() => contentUnitDefSet({ gameId }))
      .catch(() => null)
      .then((sets) => {
        kept.set(gameId, sets ?? null);
        return sets ?? null;
      });
    pending.set(gameId, asked);
  }
  return asked;
}

/** The unit lists kept for a replay, and whether the store has answered. */
function useKeptUnitLists(gameId: string | undefined, wanted: boolean) {
  const seen = useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  const [answer, setAnswer] = useState<{
    key: string;
    sets: ReplayUnitDefSets | null;
  } | null>(null);
  const key = gameId ? `${gameId}:${seen}` : undefined;

  useEffect(() => {
    if (!wanted || !gameId || !key) return;
    if (kept.has(gameId)) {
      setAnswer({ key, sets: kept.get(gameId) ?? null });
      return;
    }
    let live = true;
    void readKept(gameId).then((sets) => {
      if (live) setAnswer({ key, sets });
    });
    return () => {
      live = false;
    };
  }, [wanted, gameId, key]);

  // A replay with no game id has nothing to be filed under, so nothing is kept.
  if (!gameId) return { sets: null, ready: true };
  const current = answer && answer.key === key ? answer : null;
  return { sets: current?.sets ?? null, ready: current !== null };
}

/**
 * Where a replay's unit ids can be named from, and the units (#1145, #1176).
 *
 * Shared by the build order section, the map layers (#1152), the events table
 * and the value chart, so all of them name a unit from the same list and say
 * the same thing when there is none. Nothing is asked of unitsync or of the
 * store until `wanted` is true, which a caller sets once it has ids to name.
 *
 * `ids` says which ids the caller names. A build order's are the recorded
 * game's. An analysis event's are those of the game the analysis ran on, which
 * the engine's own list always answers for.
 */
export function useReplayUnits(
  info: DemoInfo,
  wanted: boolean,
  ids: UnitIds = "stream",
) {
  const { selected } = useScanTargetSelection();
  const scan = useUnitsyncScan(selected?.enginePath, selected?.rootPath);
  const recorded = recordedGame(info);
  const lists = useKeptUnitLists(info.gameId, wanted);
  const source: UnitSource | null =
    wanted && scan.data && !scan.loading && lists.ready
      ? pickUnitSource(
          recorded,
          scan.data.games,
          storedListFor(lists.sets, ids),
        )
      : null;
  // A stored list needs no read of the game. A live one does.
  const archive = liveGame(source)?.primaryArchive.name;
  const { dataset, status } = useUnitsyncUnitDataset(
    selected?.enginePath,
    selected?.rootPath,
    archive,
  );
  const units: UnitDatasetEntry[] | null =
    source?.kind === "stored"
      ? source.list.units
      : archive && dataset
        ? dataset.units
        : null;
  return {
    selected,
    recorded,
    source,
    /** The installed game's archive when the units are read through unitsync,
     *  and undefined when they come from a stored list or from nowhere. */
    archive,
    /** The installed game's archive to ask for build pictures, by unit key. */
    picturesArchive: pictureGame(source)?.primaryArchive.name,
    status: source?.kind === "stored" ? ("ready" as const) : status,
    /** The units in id order, or null when they cannot be read. */
    units,
    /** Every list the store holds for this replay. */
    links: lists.sets?.links ?? NO_LINKS,
  };
}

const NO_LINKS: UnitDefLink[] = [];

/**
 * Keep the unit list a replay was just read against, once (#1176).
 *
 * Only when the list came from a game installed under the replay's exact name,
 * the replay has build orders, and every one of them fits the list. A list the
 * replay's own orders contradict is not the one the match was played with, and
 * keeping it would pin a wrong list to the replay for good (#3847). A replay
 * that already has a list from this kind of read keeps that one.
 *
 * This is a side effect of a read that has already happened. It asks unitsync
 * for nothing and holds nothing up.
 */
export function useKeepUnitList(
  info: Pick<DemoInfo, "gameId">,
  source: UnitSource | null,
  units: UnitDatasetEntry[] | null,
  orders: readonly Pick<BuildOrder, "unitDefId" | "position">[] | null,
  links: readonly UnitDefLink[],
) {
  const gameId = info.gameId;
  const game: GameItem | null =
    source?.kind === "installed" ? source.game : null;
  const origin = game ? (isLooseFolder(game) ? "folder" : "archive") : null;
  const linked = links.some((link) => link.origin === origin);

  useEffect(() => {
    if (!gameId || !game || !units || !orders || linked) return;
    if (orders.length === 0 || units.length === 0) return;
    if (misfits(orderFit(orders, units)) > 0) return;
    if (handedOver.has(gameId)) return;
    handedOver.add(gameId);
    void Promise.resolve()
      .then(() =>
        contentUnitDefSetStore({
          gameId,
          game: game.name,
          archive: game.primaryArchive.name,
          units: units.map(unitToStored),
        }),
      )
      .then(() => forget(gameId))
      // Nothing was kept. The replay reads as it did, and the next visit in
      // another session tries again.
      .catch(() => {});
  }, [gameId, game, units, orders, linked]);
}
