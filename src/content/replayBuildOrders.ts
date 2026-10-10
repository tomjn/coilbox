/**
 * Turning a replay's build orders into something a page can show (#1145).
 *
 * The stream holds the engine's unit definition id and nothing else about the
 * unit. The engine numbers a game's unit definitions from 1 in the sorted
 * order of their keys (`CUnitDefHandler::Init`), and unitsync reads the same
 * table and sorts it the same way, so id `n` is entry `n - 1` of the unit
 * dataset. That holds for the build of the game the replay was played on and
 * for no other: a build with one unit more or fewer moves every id after it.
 */

import { formatDuration } from "@/lib/format";
import type {
  BuildOrder,
  DemoBuildOrders,
  DemoInfo,
  GameItem,
  UnitDatasetEntry,
} from "./bindings";
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
  /** That build is not installed and another version of the game is. Its ids
   *  can differ, so a name read from it may be the wrong unit. */
  | { kind: "differentBuild"; game: GameItem }
  /** No version of the game is installed, so no id can be named. */
  | { kind: "notInstalled" };

/**
 * Pick the installed game to read unit names from. `games` is the live
 * unitsync scan, the same list the replay page's missing-game notice reads.
 */
export function pickUnitSource(
  recorded: string,
  games: GameItem[],
): UnitSource {
  const exact = games.find((g) => gameNamesMatch(g.name, recorded));
  if (exact) return { kind: "installed", game: exact };
  // The highest name of the family, which for a game that numbers its
  // versions is the newest. No version is known to be closer than another.
  const family = games
    .filter((g) => sameGameFamily(g.name, recorded))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const other = family.at(-1);
  return other
    ? { kind: "differentBuild", game: other }
    : { kind: "notInstalled" };
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
