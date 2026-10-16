import type {
  GameItem,
  RoomAllyTeam,
  StartBoxConfig,
} from "@/content/bindings";
import type { StartArea, WorldExtent } from "./polygon";

/**
 * Zero-K reads its start boxes from a file in the game or the map rather than
 * from the lobby (issue #4194). Matched on the game's modinfo `shortname`,
 * which Zero-K's `modinfo.lua` sets to `ZK`.
 */
export function readsZerokStartBoxes(
  game: Pick<GameItem, "info"> | null | undefined,
): boolean {
  return game?.info.shortname?.trim().toUpperCase() === "ZK";
}

/**
 * One colour for every area. Zero-K deals the boxes out to ally teams at
 * random unless shuffling is off, so colouring them by ally would claim an
 * owner the lobby does not know.
 */
export const ZEROK_AREA_COLOR = "#f5f5f5";

/**
 * The players in a room grouped by ally team, in ally order, for the
 * evaluation of a start box file (issue #4214). Spectators are left out by the
 * caller.
 */
export function roomShape(
  players: { ally: number; bot: boolean }[],
): RoomAllyTeam[] {
  const byAlly = new Map<number, boolean[]>();
  for (const { ally, bot } of players) {
    byAlly.set(ally, [...(byAlly.get(ally) ?? []), bot]);
  }
  return [...byAlly]
    .sort(([a], [b]) => a - b)
    .map(([allyTeam, bots]) => ({ allyTeam, bots }));
}

/** A file's boxes as the areas `StartPolygonOverlay` draws. */
export function areasFromConfig(config: StartBoxConfig): StartArea[] {
  return config.teams.map((team) => ({
    key: String(team.id),
    label: team.nameShort ?? team.nameLong ?? undefined,
    title: team.nameLong ?? undefined,
    color: ZEROK_AREA_COLOR,
    polygons: team.boxes,
    points: team.startPoints,
  }));
}

/**
 * A map's size in world units from the scan's `width` and `height`, which are
 * the metal map's, a sixteenth of the world. The same space `MinimapPreview`
 * places start markers in. Null until both are known.
 */
export function mapExtent(
  map: { width?: number; height?: number } | null | undefined,
): WorldExtent | null {
  if (!map?.width || !map.height) return null;
  return { x: map.width * 16, z: map.height * 16 };
}
