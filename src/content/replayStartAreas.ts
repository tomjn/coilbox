import { t } from "@lingui/core/macro";
import {
  pointInPolygon,
  type StartArea,
  type WorldExtent,
  type WorldPoint,
} from "@/startbox/polygon";
import { areasFromConfig, roomShape } from "@/startbox/zerok";
import type { DemoInfo, RoomAllyTeam, StartBoxConfig } from "./bindings";
import { teamLabel } from "./replaySideLabel";

/**
 * The start areas a replay's map draws, and the extent their points are in.
 * A replay's own rectangles are fractions of the map, so they come with a
 * 1 by 1 extent. A Zero-K or Beyond All Reason shape is in world units and comes
 * with the map's size. {@link StartPolygonOverlay} places either.
 */
export interface StartAreaSet {
  areas: StartArea[];
  extent: WorldExtent;
}

/** The same colour as `NEUTRAL_TEAM_COLOUR`, in the hex form the overlay tints. */
export const NEUTRAL_AREA_COLOUR = "#94a3b8";

/** A side's colour as hex, which is what {@link StartPolygonOverlay} tints. */
function hex(rgb: readonly [number, number, number] | undefined): string {
  if (!rgb) return NEUTRAL_AREA_COLOUR;
  const channel = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

/** What an area is called on hover, and what its badge says: the side's own
 *  numbering, as the roster has it. */
function sideNaming(side: number) {
  const boxTeam = teamLabel(side);
  return { label: String(side + 1), title: t`${boxTeam} start box` };
}

/** The start rectangles a replay's setup carries, in the colour of their side. */
export function rectangleAreas(info: DemoInfo): StartAreaSet {
  const areas: StartArea[] = [];
  for (const a of info.allyTeams) {
    const box = a.startBox;
    if (!box) continue;
    areas.push({
      key: String(a.id),
      ...sideNaming(a.id),
      color: hex(a.color),
      polygons: [
        [
          [box.left, box.top],
          [box.right, box.top],
          [box.right, box.bottom],
          [box.left, box.bottom],
        ],
      ],
      points: [],
    });
  }
  return { areas, extent: { x: 1, z: 1 } };
}

/**
 * The room a start box file is evaluated for, from the replay's own sides and
 * players. Spectators are not in it.
 */
export function replayRoom(info: DemoInfo): RoomAllyTeam[] {
  const seats: { ally: number; bot: boolean }[] = [];
  for (const p of info.players)
    if (!p.spectator && p.allyTeam !== undefined)
      seats.push({ ally: p.allyTeam, bot: false });
  for (const a of info.ais)
    if (a.allyTeam !== undefined) seats.push({ ally: a.allyTeam, bot: true });
  return roomShape(seats);
}

/** The side each engine team plays for. */
function sidesByTeam(info: DemoInfo): Map<number, number> {
  const sides = new Map<number, number>();
  for (const p of info.players)
    if (!p.spectator && p.team !== undefined && p.allyTeam !== undefined)
      sides.set(p.team, p.allyTeam);
  for (const a of info.ais)
    if (a.team !== undefined && a.allyTeam !== undefined)
      sides.set(a.team, a.allyTeam);
  // The setup says it for a team the player and AI lists do not reach.
  info.matchSetup?.teams.forEach((team, id) => {
    if (!sides.has(id)) sides.set(id, team.allyTeam);
  });
  return sides;
}

/**
 * A Zero-K file's start areas, each in the colour of the side that started in
 * it. Zero-K deals areas out to sides at random in a free for all and the
 * replay does not say how it went, so the side is the one whose recorded start
 * positions are inside the area.
 *
 * An area that nobody started in is neutral and has no number. So is one that
 * players of more than one side started in, because it has no single owner to
 * name. Only the positions the replay's stream recorded decide this. The
 * analysis's start unit positions are not consulted, because they exist only
 * once the replay is analysed and only while their layers are on, and the
 * colours would change with a switch.
 */
export function zerokAreas(
  config: StartBoxConfig,
  info: DemoInfo,
  extent: WorldExtent,
): StartAreaSet {
  const sides = sidesByTeam(info);
  const starts = (info.startPositions ?? []).flatMap((s) => {
    const side = sides.get(s.team);
    return side === undefined ? [] : [{ side, at: [s.x, s.z] as WorldPoint }];
  });
  const colours = new Map(info.allyTeams.map((a) => [a.id, a.color]));
  const areas = areasFromConfig(config).map((area): StartArea => {
    const inside = new Set(
      starts
        .filter((s) => area.polygons.some((p) => pointInPolygon(s.at, p)))
        .map((s) => s.side),
    );
    const [side] = inside;
    if (inside.size !== 1 || side === undefined)
      return {
        ...area,
        label: undefined,
        title: undefined,
        color: NEUTRAL_AREA_COLOUR,
      };
    return { ...area, ...sideNaming(side), color: hex(colours.get(side)) };
  });
  return { areas, extent };
}
