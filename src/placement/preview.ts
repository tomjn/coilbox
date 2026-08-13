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

import { type Ground, standsOn, unitLimits } from "@/blueprint/buildable";
import {
  BUILD_SQUARE,
  buildingFootprints,
  type Footprint,
  type FootprintMark,
  footprintMarks,
  footprintRect,
  type Rect,
  rectsOverlap,
  type Standing,
  snapToBuildGrid,
  unjudged,
} from "@/blueprint/footprint";
import type { Facing, Point } from "@/scenario/model";
import type { BuildingUnit, Placement } from "./placements";

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
  /** Whether `units` is the game's dataset read, as {@link unitLimits} takes
   *  it. */
  checked = units.length > 0,
): PreviewChecks {
  const footprintOf = buildingFootprints(units);
  const limitsOf = unitLimits(units, checked);
  return {
    footprintOf,
    standingOf: (mark) => standsOn(mark, ground, limitsOf(mark.def)),
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
 * The building a drag is carrying, as far as the drag has got (issue #1512).
 *
 * A layout of one, so the building being positioned is drawn the way a whole
 * base being placed is: on the squares it will really stand on, marked if the
 * ground there is spoken for or too steep. Nothing else the pointer can pick up
 * has a footprint, so anything but a base's building carries nothing.
 *
 * The drag is measured from the square the building is drawn on, which is the
 * building the author took hold of, and is the same point `movePlacement`
 * carries it from (issue #1517).
 */
export function draggedBuilding(
  placements: readonly Placement[],
  key: string,
  delta: Point,
): PreviewBuilding | null {
  const placement = placements.find((one) => one.key === key);
  if (placement?.kind !== "base") return null;
  return {
    def: placement.def,
    facing: placement.facing,
    pos: { x: placement.pos.x + delta.x, z: placement.pos.z + delta.z },
  };
}

/**
 * The document's footprints without the one being dragged.
 *
 * A building in the air is drawn where it is going rather than where it came
 * from, so the ground it came from is nobody's until it lands: left in, it would
 * be a square the author never put there, and one the building would be marked
 * red for wanting back.
 *
 * The same list back when nothing is being dragged, so a surface can hand the
 * answer straight to a layer that redraws whenever it changes.
 */
export function withoutBuilding(
  marks: FootprintMark[],
  key: string | null,
): FootprintMark[] {
  return key === null ? marks : marks.filter((mark) => mark.key !== key);
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

/**
 * Where the whole layout would fit, when the spot under the pointer does not
 * (issue #1482).
 *
 * An offer, never a rule. The engine builds one of a pair of overlapping
 * buildings and refuses the rest, and a ruined base with buildings inside each
 * other is a real thing an author might mean, so nothing here moves anything:
 * it works out a spot and says so, and a person takes it or ignores it.
 *
 * Three things decide what the search means.
 *
 * The base moves as one. The shape is what is being placed, so a search that
 * moved the one offending building would be offering a different base. Every
 * building goes the same way by the same distance.
 *
 * It moves in whole build squares. Everything is snapped, so a move of less
 * than a square lands the base on the squares it is already on, and a candidate
 * that draws the same picture is not a candidate.
 *
 * It has to fit for every building, not for the one that was red. A nudge that
 * clears the overlap and stands three of the base's mills on a slope has not
 * helped anybody.
 */

/** How far the search looks, in build squares. Two five square buildings clear
 *  each other at five squares, so a bound much tighter than this would never
 *  find the spot the author is about to find by hand. */
export const NUDGE_LIMIT = 8;

/** A spot the whole layout fits, as far from the pointer as it has to be. */
export interface Nudge {
  /** How far the layout moves, in elmos, for handing to whatever places it. */
  delta: Point;
  /** The same move in build squares, which is what it is said in. */
  squares: Point;
}

/** What the surface has to say about fitting: a spot, `"nowhere"` when the
 *  search found none within its bound, or nothing to say at all. */
export type NudgeOffer = Nudge | "nowhere" | null;

/**
 * Which verdicts a different spot could change.
 *
 * Slope and depth are the ground refusing this building here, and other ground
 * may not. A unit the game has not got is refused everywhere, and an unjudged
 * building is not refused at all, so neither is anything to search on: counting
 * them would mean either hunting for a spot that cannot exist or refusing every
 * spot on a map whose heights would not read.
 */
function refusedByGround(standing: Standing): boolean {
  return standing === "slope" || standing === "depth";
}

/**
 * Whether every building of the layout lands clean with the whole thing moved
 * by `delta`.
 *
 * Building by building, giving up on the first one that is refused, because
 * most candidate spots are refused by the first thing tried and the ground is
 * the expensive question.
 */
export function fitsAt(
  buildings: readonly PreviewBuilding[],
  delta: Point,
  footprintOf: (def: string) => Footprint,
  occupied: readonly { rect: Rect }[],
  standingOf?: (mark: Omit<FootprintMark, "standing">) => Standing,
): boolean {
  const placed: Rect[] = [];
  for (const building of buildings) {
    const footprint = footprintOf(building.def);
    const pos = snapToBuildGrid(
      { x: building.pos.x + delta.x, z: building.pos.z + delta.z },
      footprint,
      building.facing,
    );
    const rect = footprintRect(pos, footprint, building.facing);
    if (occupied.some((one) => rectsOverlap(rect, one.rect))) return false;
    if (placed.some((one) => rectsOverlap(rect, one))) return false;
    if (
      standingOf &&
      refusedByGround(
        standingOf({
          key: "",
          def: building.def,
          pos,
          facing: building.facing,
          footprint,
          rect,
          overlapping: false,
        }),
      )
    ) {
      return false;
    }
    placed.push(rect);
  }
  return true;
}

/** Every move worth trying at a bound, nearest first. Ties go north, then
 *  west, then east, then south, so the same crowded spot always offers the same
 *  way out. Built once per bound, because the order never changes. */
const searches = new Map<number, Point[]>();
function nudgeCandidates(limit: number): Point[] {
  const had = searches.get(limit);
  if (had) return had;
  const out: Point[] = [];
  for (let x = -limit; x <= limit; x++) {
    for (let z = -limit; z <= limit; z++) out.push({ x, z });
  }
  out.sort(
    (a, b) =>
      a.x * a.x + a.z * a.z - (b.x * b.x + b.z * b.z) || a.z - b.z || a.x - b.x,
  );
  searches.set(limit, out);
  return out;
}

/**
 * The nearest spot the whole layout fits, or `null` when none within `limit`
 * build squares does.
 *
 * Where it already is counts as a spot and comes first, so a layout that fits
 * is answered with a move of nothing rather than with the nearest place it
 * could go instead.
 */
export function nudgeToFit(
  buildings: readonly PreviewBuilding[],
  footprintOf: (def: string) => Footprint,
  occupied: readonly { rect: Rect }[],
  standingOf?: (mark: Omit<FootprintMark, "standing">) => Standing,
  limit = NUDGE_LIMIT,
): Nudge | null {
  if (buildings.length === 0) return null;
  for (const squares of nudgeCandidates(limit)) {
    const delta = { x: squares.x * BUILD_SQUARE, z: squares.z * BUILD_SQUARE };
    if (fitsAt(buildings, delta, footprintOf, occupied, standingOf)) {
      return { delta, squares };
    }
  }
  return null;
}

/** Which way a nudge goes, in the map's own directions: `+x` is east and `+z`
 *  is south, the way the engine's facings run. */
export function nudgeWords(squares: Point): string {
  const ways: { far: number; way: string }[] = [];
  if (squares.z !== 0) {
    ways.push({
      far: Math.abs(squares.z),
      way: squares.z < 0 ? "north" : "south",
    });
  }
  if (squares.x !== 0) {
    ways.push({
      far: Math.abs(squares.x),
      way: squares.x < 0 ? "west" : "east",
    });
  }
  return ways
    .map(({ far, way }, at) =>
      at === 0
        ? `${far} ${far === 1 ? "square" : "squares"} ${way}`
        : `${far} ${way}`,
    )
    .join(" and ");
}

/** The offer in words, said next to the warning rather than instead of it. */
export function nudgeSentence(offer: NudgeOffer, limit = NUDGE_LIMIT): string {
  if (offer === null) return "";
  if (offer === "nowhere") {
    return `Nothing within ${limit} squares of here fits.`;
  }
  return `Press N to put it down ${nudgeWords(offer.squares)} instead, where it fits.`;
}

/** Whether two offers say the same thing, so a surface can leave its state
 *  alone while the pointer moves about inside one build square. */
export function sameNudge(a: NudgeOffer, b: NudgeOffer): boolean {
  if (a === null || b === null || a === "nowhere" || b === "nowhere") {
    return a === b;
  }
  return a.squares.x === b.squares.x && a.squares.z === b.squares.z;
}

/** What a preview is worth saying in words: how many of its buildings the
 *  engine would refuse, and why. Colour alone is not a statement. */
export interface PreviewCount {
  total: number;
  /** Standing on ground another building wants, its own or the map's. */
  clashes: number;
  /** Standing on ground too steep for it. */
  unstable: number;
  /** In the wrong depth of water for it: a land building in the sea, or a naval
   *  one out of it (issue #1459). */
  wrongDepth: number;
  /** Nothing has judged the ground under it, which is not the same as the
   *  ground being fine (issue #1491). */
  unjudged: number;
  /** Its unit is one this game has not got, so there is nothing to build there
   *  wherever it lands (issue #1445). */
  absent: number;
}

export function previewCount(marks: readonly FootprintMark[]): PreviewCount {
  return {
    total: marks.length,
    clashes: marks.filter((mark) => mark.overlapping).length,
    unstable: marks.filter((mark) => mark.standing === "slope").length,
    wrongDepth: marks.filter((mark) => mark.standing === "depth").length,
    unjudged: marks.filter((mark) => unjudged(mark.standing)).length,
    absent: marks.filter((mark) => mark.standing === "no-def").length,
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
    a.wrongDepth === b.wrongDepth &&
    a.unjudged === b.unjudged &&
    a.absent === b.absent
  );
}

/** Whether anything about this spot is worth an author's attention, which is
 *  what colours the sentence. */
export function previewTrouble(count: PreviewCount): boolean {
  return (
    count.clashes > 0 ||
    count.unstable > 0 ||
    count.wrongDepth > 0 ||
    count.absent > 0
  );
}

/** Whether what is wrong with this spot is the kind of wrong another spot could
 *  put right, which is what makes a search for one worth running (issue #1482).
 *  A unit the game has not got is refused everywhere, so it is not. */
export function previewMovable(count: PreviewCount): boolean {
  return count.clashes > 0 || count.unstable > 0 || count.wrongDepth > 0;
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
    const of = parts.length > 0 ? "" : ` of ${total}`;
    parts.push(
      unstable === 1
        ? `1${of} is on ground too steep for it, in amber.`
        : `${unstable}${of} are on ground too steep for them, in amber.`,
    );
  }
  if (count.wrongDepth > 0) {
    const of = parts.length > 0 ? "" : ` of ${total}`;
    parts.push(
      count.wrongDepth === 1
        ? `1${of} is in the wrong depth of water for it, in cyan.`
        : `${count.wrongDepth}${of} are in the wrong depth of water for them, in cyan.`,
    );
  }
  if (count.absent > 0) {
    const of = parts.length > 0 ? "" : ` of ${total}`;
    parts.push(
      count.absent === 1
        ? `1${of} is a unit this game has not got, in violet.`
        : `${count.absent}${of} are units this game has not got, in violet.`,
    );
  }
  return parts.join(" ") + unjudgedClause(count);
}
