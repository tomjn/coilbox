/**
 * The layout under the pointer, before the click puts it there (issue #1464).
 *
 * Placing a whole compound is not placing one building. An author putting down
 * a solar collector is looking at the ground it will stand on, and can see what
 * is already there. An author putting down twelve buildings at once cannot: the
 * base arrives where the click landed and the overlaps are found afterwards, in
 * red, with nothing to do about it but pick the base up and drag it until the
 * red goes away.
 *
 * So this answers the same question `./placements.ts` answers about the
 * document, about a layout that is not in the document yet: where each of its
 * buildings would stand, which of them would want ground something already
 * standing wants, and which of them the ground itself would refuse. The marks
 * are the same `FootprintMark`s the placed base would get, drawn by the same
 * layer in the same colours, because the whole point is that what is shown
 * before the click is what happens after it.
 *
 * Arithmetic on plain values, so all of it is tested and so it can be run
 * straight off a pointer move without React in the way. It takes its lookups
 * rather than a unit dataset: building a map of a game's thousand units on
 * every pointer move would be the expensive part of an otherwise cheap check.
 */

import { type Ground, standsOn, unitSlopes } from "@/blueprint/buildable";
import {
  buildingFootprints,
  type Footprint,
  type FootprintMark,
  footprintMarks,
  type Rect,
  rectsOverlap,
  type Standing,
  unjudged,
} from "@/blueprint/footprint";
import type { Facing, Point } from "@/scenario/model";
import type { BuildingUnit } from "./placements";

/** One building of a layout about to be placed, already offset from wherever
 *  the layout's origin would land. */
export interface PreviewBuilding {
  def: string;
  pos: Point;
  facing: Facing;
}

/** What the check reads a def with: how much ground it stands on, and whether
 *  the map's ground will take it. */
export interface PreviewChecks {
  footprintOf: (def: string) => Footprint;
  /** Always asked, even where there is no map and no dataset. It answers which
   *  reason it has no verdict rather than saying the ground is fine. */
  standingOf: (mark: Omit<FootprintMark, "standing">) => Standing;
}

/**
 * The lookups for one game's units and one map, built once so a pointer move
 * costs a lookup rather than a scan of the whole unit dataset.
 *
 * The same two `baseFootprints` builds for the document, in the same order and
 * from the same functions, which is what makes a preview and the base it turns
 * into agree.
 */
export function previewChecks(
  units: BuildingUnit[],
  ground: Ground | null,
  /** Whether `units` is the game's dataset read, as {@link unitSlopes} takes
   *  it. */
  checked = units.length > 0,
): PreviewChecks {
  const footprintOf = buildingFootprints(units);
  const slopeOf = unitSlopes(units, checked);
  return {
    footprintOf,
    standingOf: (mark) => standsOn(mark, ground, slopeOf(mark.def)),
  };
}

/**
 * Every building of a layout as it would land, marked the way a placed one is.
 *
 * `occupied` is the ground the map's own buildings are already standing on,
 * which is `baseFootprints` for the document. A preview building on any of it
 * is marked, and nothing in `occupied` is marked back: the buildings that are
 * really there are not at fault and are not changed by a pointer moving over
 * them.
 */
export function layoutPreview(
  buildings: readonly PreviewBuilding[],
  footprintOf: (def: string) => Footprint,
  occupied: readonly { rect: Rect }[],
  standingOf?: (mark: Omit<FootprintMark, "standing">) => Standing,
): FootprintMark[] {
  const marks = footprintMarks(
    buildings.map((building, at) => ({ key: String(at), ...building })),
    footprintOf,
    standingOf,
  );
  for (const mark of marks) {
    if (mark.overlapping) continue;
    mark.overlapping = occupied.some((taken) =>
      rectsOverlap(mark.rect, taken.rect),
    );
  }
  return marks;
}

/**
 * Whether two previews would land in exactly the same place.
 *
 * What makes showing a layout under a moving pointer cheap. Every building is
 * snapped to the build grid, so most of the pointer's travel lands the layout
 * where it already is, and a frame that would redraw the same squares is a
 * frame with nothing to do.
 */
export function samePlace(
  a: readonly PreviewBuilding[],
  b: readonly PreviewBuilding[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (one, at) =>
      one.def === b[at].def &&
      one.facing === b[at].facing &&
      one.pos.x === b[at].pos.x &&
      one.pos.z === b[at].pos.z,
  );
}

/** What a preview is worth saying in words: how many of its buildings the
 *  engine would refuse, and why. Colour alone is not a statement. */
export interface PreviewCount {
  total: number;
  /** Standing on ground another building wants, its own or the map's. */
  clashes: number;
  /** Standing on ground too steep for it. */
  unstable: number;
  /** Nothing has judged the ground under it, which is not the same as the
   *  ground being fine (issue #1491). */
  unjudged: number;
}

export function previewCount(marks: readonly FootprintMark[]): PreviewCount {
  return {
    total: marks.length,
    clashes: marks.filter((mark) => mark.overlapping).length,
    unstable: marks.filter((mark) => mark.standing === "slope").length,
    unjudged: marks.filter((mark) => unjudged(mark.standing)).length,
  };
}

/** Whether two counts say the same thing, so a surface can leave its state
 *  alone rather than re-rendering on every pointer move. */
export function sameCount(a: PreviewCount | null, b: PreviewCount | null) {
  if (!a || !b) return a === b;
  return (
    a.total === b.total &&
    a.clashes === b.clashes &&
    a.unstable === b.unstable &&
    a.unjudged === b.unjudged
  );
}

/** Whether anything about this spot is worth an author's attention, which is
 *  what colours the sentence. */
export function previewTrouble(count: PreviewCount): boolean {
  return count.clashes > 0 || count.unstable > 0;
}

/** What is left unsaid about this spot, when anything is. Appended rather than
 *  colouring the sentence, because an unknown is not a refusal (issue #1491). */
function unjudgedClause(count: PreviewCount): string {
  if (count.unjudged === 0) return "";
  if (count.unjudged === count.total) {
    return count.total === 1
      ? " It has not been checked against the ground."
      : " None of them has been checked against the ground.";
  }
  return ` ${count.unjudged} of them ${count.unjudged === 1 ? "has" : "have"} not been checked against the ground.`;
}

/**
 * What the marks under the pointer say, in words.
 *
 * Only overlaps and slopes are named, and a spot with neither is only said to
 * have room rather than to fit: room is about the other buildings, and the
 * ground is a separate question this may not have an answer to.
 */
export function previewSentence(count: PreviewCount): string {
  const { total, clashes, unstable } = count;
  if (!previewTrouble(count)) {
    const room =
      total === 1
        ? "1 building, and it has room here."
        : `${total} buildings, and they all have room here.`;
    return room + unjudgedClause(count);
  }
  const parts: string[] = [];
  if (clashes > 0) {
    parts.push(
      `${clashes} of ${total} want${clashes === 1 ? "s" : ""} ground another building has, in red.`,
    );
  }
  if (unstable > 0) {
    const of = clashes > 0 ? "" : ` of ${total}`;
    parts.push(
      unstable === 1
        ? `1${of} is on ground too steep for it, in amber.`
        : `${unstable}${of} are on ground too steep for them, in amber.`,
    );
  }
  return parts.join(" ") + unjudgedClause(count);
}
