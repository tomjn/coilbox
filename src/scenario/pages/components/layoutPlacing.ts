/**
 * What the editor can place a base from, and how one of them is named in a
 * picker (issues #1327, #1450).
 *
 * Two places hold a layout an author might want on the map, and they behave
 * differently:
 *
 * - The scenario itself. Placing one of these adds a placement and nothing
 *   else, so two bases from one layout are one shape in two places and an edit
 *   through either goes through `LayoutEdit`. This is the only way an unplaced
 *   layout gets back on the map.
 * - The library, `@/blueprint/library.ts`. Placing one of these copies it into
 *   the document first, because a scenario is shared as one payload and a base
 *   pointing at a layout outside it would work for its author and for nobody
 *   they send it to.
 *
 * The library is offered whole rather than filtered to the scenario's game. A
 * layout for another game is a real thing to want, whether because the games
 * share unit names or because the author is about to change the game, so it is
 * listed and warned about rather than hidden. `@/blueprint/arrival.ts` is the
 * warning.
 *
 * Arithmetic on plain values. The controls are `LayoutPlacer.tsx` and the mode
 * that uses them is `modes.tsx`.
 */

import type { SnapBuilding } from "@/blueprint/footprint";
import { recordGameName, type StoredBlueprint } from "@/blueprint/library";
import type { BlueprintBuilding } from "@/blueprint/model";
import type { PreviewBuilding } from "@/placement/preview";
import type { Point, Scenario } from "../../model";

/** Where a layout the editor is about to place is coming from. */
export type LayoutSource = "scenario" | "library";

/** One layout the editor can place, named by where it lives as well as by its
 *  id: a scenario layout and a library one can be told apart no other way. */
export interface LayoutChoice {
  from: LayoutSource;
  id: string;
}

/** A choice as one string, because a picker's value is one string. */
export function layoutChoiceKey(choice: LayoutChoice): string {
  return `${choice.from}:${choice.id}`;
}

/** The choice a key names, or null when it names nothing this understands. */
export function parseLayoutChoice(key: string): LayoutChoice | null {
  const at = key.indexOf(":");
  if (at < 0) return null;
  const from = key.slice(0, at);
  const id = key.slice(at + 1);
  if ((from !== "scenario" && from !== "library") || !id) return null;
  return { from, id };
}

/**
 * Where a layout dropped at `pos` puts its origin, so the base lands on the
 * build grid rather than near it.
 *
 * The engine only stands a building on the grid, and the grid is absolute: a
 * base whose origin is half a square out arrives with every building in it off
 * the lattice it was drawn on, and the engine free to shuffle each one up to
 * half a square on its own. That is the same reason `setOrigin` moves a base in
 * whole squares rather than to the click.
 *
 * The first building is what is aligned, and every other one keeps its offset
 * from it. An offset was drawn against the first building's grid position, so
 * putting that one right puts the rest right, including a layout mixing odd and
 * even footprints, whose buildings are half a square out of phase with each
 * other on purpose.
 *
 * `pos` unchanged for a layout with nothing in it, and while the game's units
 * are unread: without a footprint there is no phase to work out, and guessing
 * one square would move the even-footprint layouts onto the wrong half of the
 * grid.
 */
export function layoutOrigin(
  pos: Point,
  buildings: readonly BlueprintBuilding[],
  /** Undefined while the game's units are unread, which is not the same as a
   *  snap that treats every def as one square. */
  snap: SnapBuilding | undefined,
): Point {
  const first = buildings[0];
  if (!first || !snap) return pos;
  const stand = snap(
    { x: pos.x + first.offset.x, z: pos.z + first.offset.z },
    first.def,
    first.facing,
  );
  return { x: stand.x - first.offset.x, z: stand.z - first.offset.z };
}

/**
 * Every building of a layout as it would stand if it were dropped at `pos`,
 * for showing under the pointer before the click (issue #1464).
 *
 * {@link layoutOrigin} and the offsets, which is exactly what the click itself
 * does, so what is shown is what happens. Empty while the game's units are
 * unread, for the reason `layoutOrigin` leaves the point alone then: without a
 * footprint every def looks like one square, and a shape drawn on that guess is
 * a shape nobody is about to place.
 */
export function layoutGhost(
  pos: Point,
  buildings: readonly BlueprintBuilding[],
  snap: SnapBuilding | undefined,
): PreviewBuilding[] {
  if (!snap) return [];
  const origin = layoutOrigin(pos, buildings, snap);
  return buildings.map((building) => ({
    def: building.def,
    pos: { x: origin.x + building.offset.x, z: origin.z + building.offset.z },
    facing: building.facing,
  }));
}

/** One layout offered in the picker. */
export interface LayoutOption {
  value: string;
  label: string;
  /** Where it lives and what it is made of, in a few words. */
  description: string;
  /**
   * A layout with nothing in it, which is offered greyed rather than left out.
   *
   * The one thing here that refuses. A base with no buildings draws nothing and
   * can never be clicked on again, so placing an empty layout would put a thing
   * in the document that the author cannot see, select or delete. Every other
   * reason a layout might be a bad fit, another game or a missing unit, is
   * warned about and still allowed.
   */
  disabled?: boolean;
}

/** "1 building" or "3 buildings", so a description reads as English. */
function buildings(n: number): string {
  return `${n} building${n === 1 ? "" : "s"}`;
}

/**
 * Everything an author can place a base from, this scenario's layouts first.
 *
 * The scenario's own come first because they are the ones an author is working
 * on, and an unplaced one says so: that is the layout they deleted a base of
 * and came here to put back.
 *
 * A library layout for another game is listed last and named by its game, so
 * the picker itself says which of them belong to this mission before anything
 * is chosen. `gameName` is the scenario's game, which is empty on a scenario
 * that has not picked one, and then nothing is sorted by it.
 */
export function layoutOptions(
  scenario: Pick<Scenario, "blueprints" | "bases">,
  records: readonly StoredBlueprint[],
  gameName: string,
): LayoutOption[] {
  const placed = new Set(scenario.bases.map((base) => base.blueprint));
  const mine = scenario.blueprints.map<LayoutOption>((layout) => ({
    value: layoutChoiceKey({ from: "scenario", id: layout.id }),
    label: layout.name,
    description: [
      "In this scenario",
      buildings(layout.buildings.length),
      placed.has(layout.id) ? null : "not placed",
    ]
      .filter(Boolean)
      .join(" · "),
    ...(layout.buildings.length === 0 ? { disabled: true } : {}),
  }));

  const theirs = records.map<LayoutOption>((record) => {
    const game = recordGameName(record);
    const mismatch = gameName !== "" && game !== "" && game !== gameName;
    return {
      value: layoutChoiceKey({ from: "library", id: record.id }),
      label: record.layout.name,
      description: [
        "Your library",
        buildings(record.layout.buildings.length),
        mismatch ? game : null,
      ]
        .filter(Boolean)
        .join(" · "),
      ...(record.layout.buildings.length === 0 ? { disabled: true } : {}),
    };
  });

  // Stable within each half, so the library keeps its own most-recent-first
  // order and only the wrong game's layouts move.
  const wrongGame = (record: StoredBlueprint) => {
    const game = recordGameName(record);
    return gameName !== "" && game !== "" && game !== gameName ? 1 : 0;
  };
  const sorted = records
    .map((record, at) => ({ at, rank: wrongGame(record) }))
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .map(({ at }) => theirs[at]);

  return [...mine, ...sorted];
}
