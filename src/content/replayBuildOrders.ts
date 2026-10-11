/**
 * Turning a replay's build orders into something a page can show (#1145).
 *
 * The stream holds the engine's unit definition id and nothing else about the
 * unit. The engine numbers a game's unit definitions from 1 in the sorted
 * order of their keys (`CUnitDefHandler::Init`), and unitsync reads the same
 * table and sorts it the same way, so id `n` is entry `n - 1` of the unit
 * dataset. That holds for the build of the game the replay was played on and
 * for no other: a build with one unit more or fewer moves every id after it.
 *
 * It does not hold for the game's own list even for that build (#3847). The
 * engine ran the game's definitions with the match's mod options, teams and
 * AIs, and gave no id to a definition it refused. Beyond All Reason adds units
 * for several mod options and for a Scavengers or Raptors AI. So the build a
 * replay was played on is read with the replay's own setup, which gives the
 * list the engine built for that match as far as a start script can say. The
 * engine's own list, which an analysis run records, needs none of that.
 * `orderFit` in `replayUnitDefs.ts` is the check for what is left.
 */

import { formatDuration } from "@/lib/format";
import type {
  BuildOrder,
  DemoBuildOrders,
  DemoInfo,
  GameItem,
  UnitDatasetEntry,
} from "./bindings";
import type { StoredUnitList } from "./replayUnitDefs";
import { gameNamesMatch, sameGameFamily } from "./resolveContent";

/** Simulation frames per second of match time. */
const FRAMES_PER_SECOND = 30;

/** An order's match time, or a label for one sent before the game started. */
export function buildOrderTime(frame: number): string {
  return frame < 0
    ? "Pre-game"
    : formatDuration(Math.floor(frame / FRAMES_PER_SECOND));
}

/**
 * The game whose build assigned the ids in a replay. A remix is a copy pointed
 * at another game, and its orders still carry the ids of the game it was
 * recorded on.
 */
export function recordedGame(
  info: Pick<DemoInfo, "gameType" | "remixed" | "sourceGametype">,
): string {
  return info.remixed && info.sourceGametype
    ? info.sourceGametype
    : info.gameType;
}

/** Where the names for a replay's unit ids can come from. */
export type UnitSource =
  /** A game is installed under the name and version the replay records. A
   *  replay names its game and holds no checksum of it, so this is a match on
   *  the name alone. */
  | { kind: "installed"; game: GameItem }
  /** A unit list kept for this replay (#1176): the engine's own from an
   *  analysis run, or the one recorded when the replay was first read against
   *  its installed game. `pictures` is an installed game of the same family to
   *  ask for build pictures by unit key, or null when none is installed. */
  | { kind: "stored"; list: StoredUnitList; pictures: GameItem | null }
  /** That build is not installed, no list was kept, and another version of
   *  the game is installed. Its ids can differ, so a name read from it may be
   *  the wrong unit. */
  | { kind: "differentBuild"; game: GameItem }
  /** No version of the game is installed and no list was kept while one was,
   *  so no id can be named. */
  | { kind: "notInstalled" };

/**
 * Whether an installed game is a loose folder. A folder can change under its
 * name, which a packaged archive cannot, so a name match on one says nothing
 * about which definitions it holds today.
 */
export function isLooseFolder(game: GameItem): boolean {
  return /\.sdd$/i.test(game.primaryArchive.name);
}

/**
 * Pick where to read a replay's unit names from. `games` is the live unitsync
 * scan, the same list the replay page's missing-game notice reads. `stored` is
 * the list kept for this replay, if any.
 *
 * In order: the engine's own list, which is the numbering the match used. Then
 * a packaged archive installed under the replay's exact name. Then a kept list,
 * which also stands in for an exact match that is a loose folder, because the
 * list is what the folder held when the replay was read and the folder is
 * whatever it holds now. Then another installed version, with a warning.
 */
export function pickUnitSource(
  recorded: string,
  games: GameItem[],
  stored?: StoredUnitList | null,
): UnitSource {
  const exact = games.find((g) => gameNamesMatch(g.name, recorded));
  // The highest name of the family, which for a game that numbers its
  // versions is the newest. No version is known to be closer than another.
  const family = games
    .filter((g) => sameGameFamily(g.name, recorded))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const other = family.at(-1);
  if (
    stored &&
    (stored.link.origin === "engine" || !exact || isLooseFolder(exact))
  ) {
    return { kind: "stored", list: stored, pictures: exact ?? other ?? null };
  }
  if (exact) return { kind: "installed", game: exact };
  return other
    ? { kind: "differentBuild", game: other }
    : { kind: "notInstalled" };
}

/** The installed game a source reads its units from through unitsync, or null
 *  for a source that has no need to. */
export function liveGame(source: UnitSource | null): GameItem | null {
  return source?.kind === "installed" || source?.kind === "differentBuild"
    ? source.game
    : null;
}

/** The installed game to ask for build pictures, by unit key. */
export function pictureGame(source: UnitSource | null): GameItem | null {
  return source?.kind === "stored" ? source.pictures : liveGame(source);
}

/**
 * The unit a definition id names in `units`, a dataset sorted by internal
 * name, or undefined for an id the dataset does not reach.
 */
export function resolveBuildUnit(
  unitDefId: number,
  units: UnitDatasetEntry[] | null | undefined,
): UnitDatasetEntry | undefined {
  return units?.[unitDefId - 1];
}

/** One seat's orders: a player, or a skirmish AI. */
export interface BuildOrderSeat {
  key: string;
  name: string;
  /** The team the seat's first order was for. */
  team?: number;
  orders: BuildOrder[];
}

/**
 * Split the orders by who gave them, each seat's in the order they were given.
 * A skirmish AI's orders are sent by the player hosting it, so they are kept
 * apart from that player's own and named after the AI.
 */
export function buildOrderSeats(
  result: Pick<DemoBuildOrders, "orders" | "players">,
  info: Pick<DemoInfo, "ais">,
): BuildOrderSeat[] {
  const names = new Map(result.players.map((p) => [p.player, p.name]));
  const seats = new Map<string, BuildOrderSeat>();
  for (const order of result.orders) {
    const ai = order.origin.kind === "ai" ? order.origin : null;
    const key = ai ? `ai-${ai.team}-${ai.ai}` : `player-${order.player}`;
    let seat = seats.get(key);
    if (!seat) {
      seat = {
        key,
        name: ai
          ? (info.ais.find((a) => a.team === ai.team)?.name ??
            `AI on team ${ai.team}`)
          : (names.get(order.player) ?? `Player ${order.player}`),
        team: order.team,
        orders: [],
      };
      seats.set(key, seat);
    }
    seat.orders.push(order);
  }
  return [...seats.values()];
}

/** Where an order went in the queue, when that is worth a word. An order
 *  added to the end, or one that replaced the queue, gets none. */
export function slotNote(order: BuildOrder): string | null {
  const slot = order.slot;
  if (slot.kind === "front") return "front of queue";
  if (slot.kind === "insertAt") {
    if (slot.position === 0) return "inserted first";
    if (slot.position === -1) return "inserted last";
    return `inserted at ${slot.position}`;
  }
  if (slot.kind === "insertAtTag") return "inserted mid-queue";
  return null;
}
