/**
 * The ground a base's buildings stand on, drawn on the editor's map.
 *
 * A building is not a model floating at a point: it occupies whole build squares
 * and the engine will not let a second one have any of them. Drawing that patch
 * is the difference between a layout an author thinks fits and one that does
 * (issue #1311). The square is the real footprint, turned with the building, and
 * it is drawn where the engine will stand it rather than where the document put
 * it, so a layout written by hand shows what will actually happen to it.
 *
 * Two buildings wanting the same ground are drawn in red. Both of them, because
 * neither is the one at fault, and it is the pair that has to be pulled apart.
 * A building on ground too steep for it is drawn in amber (issue #1315), which
 * is the same statement about a different reason the engine will refuse it.
 *
 * A building nothing has judged is drawn as an empty dashed square (issue
 * #1491). That is a third state rather than a quieter version of the first: an
 * unknown is not a failure, and it is not an approval either.
 *
 * The square is also what says a building is selected (issue #1716). It keeps
 * whatever colour its verdict gave it and thickens its border inwards, so being
 * selected cannot paint over a refusal and cannot change how much ground the
 * building is claiming.
 *
 * Nothing here carries a `placementKey` and the layer is not handed to
 * `useMapEditing`, so a footprint cannot be clicked. It lies under the building
 * it belongs to and would otherwise swallow every click meant for that building.
 * The pointer does reach the selected building's square, by arithmetic rather
 * than by a ray: see `useMapEditing`.
 *
 * The arithmetic is `@/blueprint/footprint`, which is tested. This file is the
 * drawing.
 */

import * as THREE from "three";

import {
  BUILD_SQUARE,
  type FootprintMark,
  unjudged,
} from "@/blueprint/footprint";
import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import type { Point } from "@/scenario/model";
import { animates, arrivals, eased, fadeAt, pulseAt } from "./arrivals";
import { worldToScene } from "./scene";

/** What the footprints are drawn under, so they can be found and removed as one
 *  thing. */
const ROOT_NAME = "scenario-footprints";

/**
 * How far above the ground a footprint sits, in elmos.
 *
 * A hair, because the square is the ground the building stands on and anything
 * more reads as a plate hovering under it (issue #1716). Not nothing, because
 * the relief is drawn by a shader this layer only samples, so a square laid
 * exactly on the sampled height would fight the terrain it lies on.
 */
const LIFT_ELMOS = 1;

/** How far the corners are rounded, in elmos: half a build square (issue
 *  #1716). Enough to read as a plate rather than a wireframe box, small enough
 *  that the square a building stands on is still square. */
const CORNER_ELMOS = BUILD_SQUARE / 2;

/**
 * How far the selected building's border is thickened, in elmos, and inwards
 * (issue #1716).
 *
 * Inwards because the border is not the statement: the ground the building has
 * is. A border drawn outwards would say the building claims a quarter of a build
 * square more than it does, which is the one thing these squares exist to be
 * exact about.
 */
const BAND_ELMOS = 3;

/** How long the selected building's border takes to breathe in and out, in
 *  milliseconds, and how far it dims at the bottom of that. */
const PULSE_MS = 1800;
const PULSE_LOW = 0.45;

/** How long a square takes to fade in when a building arrives, and out when one
 *  goes, in milliseconds. Short: this is the difference between a thing
 *  appearing and a thing being there all along, not an entrance. */
const ARRIVE_MS = 220;
const LEAVE_MS = 160;

/**
 * What ground nobody is fighting over is drawn in, what a pair fighting over it
 * turns, and what ground too steep to build on turns. Deliberately quiet until
 * something is wrong.
 *
 * Two colours rather than one because the two are fixed differently. A clash is
 * pulled apart by moving either building, and a building the ground refuses has
 * to go somewhere flatter, or nowhere.
 */
const GROUND_COLOR = 0x94a3b8;
const CLASH_COLOR = 0xf87171;
const SLOPE_COLOR = 0xfbbf24;

/**
 * What a building in the wrong depth of water is drawn in (issue #1459). Its
 * own colour because it is fixed its own way: this one moves to the water, or
 * out of it, and no amount of flatter ground helps.
 *
 * One colour for both ends of the engine's band (issue #1552). Too much water
 * over a building and too little are the same rule read from opposite sides,
 * and which way to move it is a thing to say in words rather than a fifth
 * colour to learn. A legend of five is a legend nobody reads.
 */
const DEPTH_COLOR = 0x22d3ee;

/** What a building nothing has judged is outlined in: brighter than the ground
 *  colour, because an empty dashed square has no fill to be seen by. */
const UNJUDGED_COLOR = 0xcbd5e1;

/** What a building whose unit the game has not got is drawn in (issue #1445).
 *  A third refusal colour, because it is fixed neither by moving the building
 *  nor by finding flatter ground: that unit is not in this game. */
const ABSENT_COLOR = 0xa78bfa;

/** What the building the pointer is holding is drawn in, when nothing is wrong
 *  with where it is being held (issue #1512). The colour the selection ring
 *  was, because it is saying what the ring said: this is the one you have. A
 *  spot being offered takes it too, for the same reason: it is about the
 *  building being worked on rather than about one that is standing. */
const HELD_COLOR = 0x7dd3fc;

/** The dashes of that outline, in elmos. A build square is 16, so a dash and a
 *  gap fall inside the smallest footprint there is. */
const DASH_ELMOS = 7;
const GAP_ELMOS = 5;

/**
 * What one set of marks is about (issues #1512, #1541, #1543).
 *
 * `"standing"` is ground a building is on. `"held"` is the building the pointer
 * is carrying. `"offered"` is a spot something would go to if an offer were
 * taken, which is where a turn will stand a building and where a nudge would
 * put a layout: nothing is there yet, so it is an outline with no fill.
 */
export type MarkAs = "standing" | "held" | "offered";

/** How one footprint is drawn. */
export interface FootprintStyle {
  color: number;
  /** How solid the patch is. Zero draws no patch at all. */
  fill: number;
  outline: number;
  /** A dashed outline, which is what says nothing judged this building. */
  dashed: boolean;
  /** How far the border is thickened inwards, in elmos, which is what says this
   *  building is the selected one (issue #1716). Zero for every other one. */
  band: number;
  /** Whether that thickened border breathes. Only the selected building's
   *  does, and only where motion is wanted. */
  pulse: boolean;
}

/**
 * Which of the three states this building is in (issue #1491).
 *
 * The three are read apart by the shape rather than by the colour, because a
 * colour on its own asks somebody to remember a key. A refusal is a filled
 * square with a bold edge, a building nobody is refusing is a quiet filled
 * square, and a building nothing has judged is an empty dashed one. Within a
 * refusal the colour says which of the four it is, because they are fixed
 * differently. There was
 * no third state before: a building the check could not judge and one it
 * approved of were both the quiet grey square, which is how the check managed
 * to refuse every map it was given for months without anybody noticing (issue
 * #1483).
 *
 * A clash wins the colour, because it is the one the author put there and the
 * ground under it may well be fine once the pair is pulled apart.
 *
 * `"held"` is the building the pointer is carrying (issue #1512). It is the
 * same three states said louder: a refusal keeps its own colour, because red is
 * the answer to where this is being dropped and being held cannot paint over
 * it, and a building nothing has judged keeps its empty dashed square, because
 * the shape is the statement. Only the state with nothing to say takes a colour
 * of its own, which is the one thing the selection ring was for.
 *
 * `"offered"` is a spot rather than a building (issues #1541, #1543): where a
 * turn will stand the building, or where a nudge would put the layout. It is
 * drawn beside the thing it is about, so it takes no fill at all: two filled
 * squares half a build square apart read as one smeared square rather than as a
 * move. A refusal still keeps its colour, because a turn that will land a
 * building in its neighbour is exactly what this is for.
 *
 * `selected` is the building the author is working on (issue #1716), and it is
 * the same statement `"held"` makes about a building in the air. Its border is
 * thickened inwards and breathes, so what says "this one" is the shape rather
 * than a colour: a selected building that clashes is still red, and its square
 * still covers exactly the ground the engine will give it.
 */
export function footprintStyle(
  mark: Pick<FootprintMark, "overlapping" | "standing">,
  as: MarkAs = "standing",
  /** Whether this is the building the author has selected (issue #1716). */
  selected = false,
  /** Whether motion is wanted, which is the only thing the pulse turns on. */
  motion = true,
): FootprintStyle {
  const held = as === "held";
  const offered = as === "offered";
  const fill = offered ? 0 : held ? 0.45 : selected ? 0.4 : 0.32;
  const outline = held || offered || selected ? 1 : 0.95;
  // The selected building is picked out by the shape of its border rather than
  // by a colour, so a refusal keeps saying what it says. The one state with
  // nothing to say takes the colour too, at the bottom of this.
  const band = selected ? BAND_ELMOS : 0;
  const pulse = selected && motion;
  const picked = { band, pulse };
  if (mark.overlapping) {
    return { color: CLASH_COLOR, fill, outline, dashed: false, ...picked };
  }
  if (mark.standing === "slope") {
    return { color: SLOPE_COLOR, fill, outline, dashed: false, ...picked };
  }
  if (mark.standing === "too-deep" || mark.standing === "too-shallow") {
    return { color: DEPTH_COLOR, fill, outline, dashed: false, ...picked };
  }
  if (mark.standing === "no-def") {
    return { color: ABSENT_COLOR, fill, outline, dashed: false, ...picked };
  }
  if (unjudged(mark.standing)) {
    return {
      color: held || offered || selected ? HELD_COLOR : UNJUDGED_COLOR,
      fill: 0,
      outline: held || offered || selected ? 1 : 0.8,
      dashed: true,
      ...picked,
    };
  }
  if (offered) {
    return { color: HELD_COLOR, fill: 0, outline: 1, dashed: false, ...picked };
  }
  if (held || selected) {
    return {
      color: HELD_COLOR,
      fill: held ? 0.3 : fill,
      outline: 1,
      dashed: false,
      ...picked,
    };
  }
  return {
    color: GROUND_COLOR,
    fill: 0.12,
    outline: 0.55,
    dashed: false,
    ...picked,
  };
}

export interface FootprintsLayerDeps {
  handle: MapScene3D;
  /** Map extent in elmos, as `useMissionMapAssets` reports it. */
  worldWidth: number;
  worldHeight: number;
  /** The map's ground height in elmos at an engine position. */
  groundAt: (pos: Point) => number;
  /**
   * Whether a square fades in when a building arrives and out when one goes
   * (issue #1716).
   *
   * For the document's own squares. A layer drawing what the pointer is holding
   * says no: what it draws follows the pointer from square to square, and a
   * fade would smear that into a trail.
   */
  arriving?: boolean;
  /** Whether motion is wanted at all, read at draw time because it is a
   *  preference somebody can change while the editor is open. */
  motion?: () => boolean;
}

export interface FootprintsLayer {
  root: THREE.Group;
  /** Draw this list, replacing whatever was drawn before. `as` says what the
   *  marks are about: ground being stood on, the building the pointer is
   *  carrying, or a spot being offered. `selected` is the mark key the author
   *  has picked, whose square says so (issue #1716). */
  draw: (marks: FootprintMark[], as?: MarkAs, selected?: string | null) => void;
  dispose: () => void;
}

/** How far the corners of a footprint this size are rounded. Half a build
 *  square, except on a building too small to give up that much, which is
 *  nothing the engine has but is what a footprint of one square would ask for
 *  if the rounding were any larger. */
export function cornerRadius(width: number, depth: number): number {
  return Math.max(0, Math.min(CORNER_ELMOS, width / 2, depth / 2));
}

/** A footprint as a shape in the ground plane, corners and all, measured in
 *  elmos around its middle. */
function roundedShape(width: number, depth: number): THREE.Shape {
  const x = width / 2;
  const z = depth / 2;
  const r = cornerRadius(width, depth);
  const shape = new THREE.Shape();
  if (r <= 0) {
    shape.moveTo(-x, -z);
    shape.lineTo(x, -z);
    shape.lineTo(x, z);
    shape.lineTo(-x, z);
    shape.closePath();
    return shape;
  }
  shape.moveTo(-x + r, -z);
  shape.lineTo(x - r, -z);
  shape.absarc(x - r, -z + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x, z - r);
  shape.absarc(x - r, z - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-x + r, z);
  shape.absarc(-x + r, z - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-x, -z + r);
  shape.absarc(-x + r, -z + r, r, Math.PI, Math.PI * 1.5, false);
  shape.closePath();
  return shape;
}

/** How finely a rounded corner is drawn. Four segments a corner is smooth at
 *  the zoom a layout is edited at and is eight triangles a footprint. */
const CORNER_STEPS = 4;

/** A shape laid flat on the ground, which is where every one of these goes. */
function flat(shape: THREE.Shape): THREE.ShapeGeometry {
  const geometry = new THREE.ShapeGeometry(shape, CORNER_STEPS);
  // A shape's own y becomes the map's z, so the points are read the way they
  // were written.
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/**
 * The outline of a footprint, in elmos around its middle.
 *
 * The first corner is repeated rather than the loop being closed by a
 * `LineLoop`, because a dashed line needs `computeLineDistances` and that only
 * measures the segments a geometry actually holds. A loop's closing edge is not
 * one of them, so it would come out solid.
 */
function outlinePoints(width: number, depth: number): THREE.Vector3[] {
  const flat2d = roundedShape(width, depth).getPoints(CORNER_STEPS);
  const points = flat2d.map((at) => new THREE.Vector3(at.x, 0, at.y));
  points.push(points[0].clone());
  return points;
}

/**
 * The thickened border of the selected building: its own square with a smaller
 * one cut out of it.
 *
 * Cut out rather than drawn as a second, thinner square inside the first,
 * because the border has to be solid for its breathing to read as one thing
 * rather than as two edges going in and out of step.
 */
function bandShape(width: number, depth: number, band: number): THREE.Shape {
  const outer = roundedShape(width, depth);
  const inner = roundedShape(width - band * 2, depth - band * 2);
  const hole = new THREE.Path();
  const back = inner.getPoints(CORNER_STEPS).reverse();
  hole.moveTo(back[0].x, back[0].y);
  for (const at of back.slice(1)) hole.lineTo(at.x, at.y);
  hole.closePath();
  outer.holes.push(hole);
  return outer;
}

/**
 * What one drawn square is, while it is drawn and while it is going.
 *
 * A pass rebuilds every square it draws, because an edit can change any of
 * them and comparing is more work than rebuilding. What survives a pass is when
 * the building arrived, so a redraw is not an arrival: see `./arrivals.ts`.
 */
interface Drawn {
  group: THREE.Group;
  /** What one pass allocated, freed when this square is rebuilt or dropped. */
  spent: { dispose: () => void }[];
  /** Every material the fade dims, and what each sits at at full strength. */
  fading: { material: THREE.Material; full: number }[];
  /** The selected building's border, which breathes rather than sitting
   *  still. */
  pulsing: { material: THREE.Material; full: number } | null;
  /** When this building's square first went up, on the animation clock. */
  born: number;
  /** When it stopped being drawn, while it is fading out. */
  gone: number | null;
}

/**
 * What names one drawn square, for telling an arrival from a redraw.
 *
 * The ground it stands on and the unit standing there, rather than the key the
 * document gave it. A base's buildings are keyed by their place in its list, so
 * deleting the second of five renames three of them, and a diff on those keys
 * would say three buildings had gone and three arrived.
 */
function markName(mark: FootprintMark): string {
  const { minX, minZ, maxX, maxZ } = mark.rect;
  return `${mark.def}|${minX},${minZ},${maxX},${maxZ}`;
}

export function createFootprintsLayer(
  deps: FootprintsLayerDeps,
): FootprintsLayer {
  const { handle } = deps;
  const root = new THREE.Group();
  root.name = ROOT_NAME;
  handle.scene.add(root);

  /** What is drawn now, by name, and what is on its way out. Each footprint is
   *  its own size, so there is nothing to share between two of them. */
  let drawn = new Map<string, Drawn>();
  let leaving: Drawn[] = [];
  let frame: number | null = null;

  /** Whether this layer animates at all, asked at draw time because reduced
   *  motion is a preference somebody can change while the editor is open. */
  const moving = () => animates && deps.motion?.() !== false;
  const arriveMs = () => (deps.arriving && moving() ? ARRIVE_MS : 0);
  const leaveMs = () => (deps.arriving && moving() ? LEAVE_MS : 0);

  const buildMark = (
    mark: FootprintMark,
    as: MarkAs,
    selected: boolean,
    born: number,
  ): Drawn => {
    const style = footprintStyle(mark, as, selected, moving());
    const width = mark.rect.maxX - mark.rect.minX;
    const depth = mark.rect.maxZ - mark.rect.minZ;
    const spent: { dispose: () => void }[] = [];
    const fading: { material: THREE.Material; full: number }[] = [];
    let pulsing: { material: THREE.Material; full: number } | null = null;
    const group = new THREE.Group();
    const at = worldToScene(
      mark.pos,
      deps.worldWidth,
      deps.worldHeight,
      handle.scale,
    );
    group.position.set(
      at.x,
      (deps.groundAt(mark.pos) + LIFT_ELMOS) * handle.scale,
      at.z,
    );
    // Everything below is in elmos, so the whole footprint takes the elmo scale.
    group.scale.setScalar(handle.scale);

    // Everything below is depth tested, so a hill in front of a square hides it
    // the way it hides the building standing on it, and the building itself
    // stands on its own square. A building with no verdict has no patch at all,
    // so an empty square cannot be read as ground anybody has approved of.
    if (style.fill > 0) {
      const fillGeometry = flat(roundedShape(width, depth));
      const fillMaterial = new THREE.MeshBasicMaterial({
        color: style.color,
        transparent: true,
        opacity: style.fill,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      group.add(new THREE.Mesh(fillGeometry, fillMaterial));
      spent.push(fillGeometry, fillMaterial);
      fading.push({ material: fillMaterial, full: style.fill });
    }

    // The selected building's border, thickened into the square rather than out
    // of it (issue #1716). Depth tested, like the patch it sits on: it is ground
    // the building is standing on, so the building stands in front of it. Drawn
    // after that patch, because the two are the same plane and neither writes
    // depth, so what is drawn second is what is seen.
    if (style.band > 0) {
      const bandGeometry = flat(
        bandShape(width, depth, Math.min(style.band, width / 2, depth / 2)),
      );
      const bandMaterial = new THREE.MeshBasicMaterial({
        color: style.color,
        transparent: true,
        opacity: style.outline,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const band = new THREE.Mesh(bandGeometry, bandMaterial);
      band.renderOrder = 1;
      group.add(band);
      spent.push(bandGeometry, bandMaterial);
      if (style.pulse)
        pulsing = { material: bandMaterial, full: style.outline };
      else fading.push({ material: bandMaterial, full: style.outline });
    }

    // The outline is too, so a building stands on its square rather than inside
    // a box drawn over it (issue #1716). It was drawn through everything, which
    // put a line across the front of every model on the map and, once the
    // selected building's border was thickened, a bar across it.
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(
      outlinePoints(width, depth),
    );
    const lineMaterial = style.dashed
      ? new THREE.LineDashedMaterial({
          color: style.color,
          transparent: true,
          opacity: style.outline,
          // Both the geometry and the distances are in elmos, so the dashes are
          // the same length on a small footprint and a large one.
          scale: 1,
          dashSize: DASH_ELMOS,
          gapSize: GAP_ELMOS,
        })
      : new THREE.LineBasicMaterial({
          color: style.color,
          transparent: true,
          opacity: style.outline,
        });
    const outline = new THREE.Line(lineGeometry, lineMaterial);
    // A dashed material draws solid without this, which would put a building
    // with no verdict back to looking like one that passed.
    outline.computeLineDistances();
    outline.renderOrder = 2;
    group.add(outline);

    spent.push(lineGeometry, lineMaterial);
    fading.push({ material: lineMaterial, full: style.outline });
    return { group, spent, fading, pulsing, born, gone: null };
  };

  /** A drawn square's materials all take one opacity: a square half faded in is
   *  half of everything it is made of. */
  const dim = (square: Drawn, at: number, now: number) => {
    for (const { material, full } of square.fading)
      material.opacity = full * at;
    if (square.pulsing) {
      const { material, full } = square.pulsing;
      material.opacity = at * pulseAt(now, PULSE_MS, full * PULSE_LOW, full);
    }
  };

  const drop = (square: Drawn) => {
    square.group.removeFromParent();
    for (const spent of square.spent) spent.dispose();
  };

  /**
   * Every square as it stands at this moment, and whether any of them will want
   * another frame after it.
   *
   * The clock is the browser's, so the pulse of a square drawn a moment ago is
   * in step with one drawn a minute ago rather than starting again under it.
   */
  const apply = (now: number): boolean => {
    let busy = false;
    for (const square of drawn.values()) {
      const at = eased(fadeAt(now - square.born, arriveMs()));
      dim(square, at, now);
      if (at < 1 || square.pulsing) busy = true;
    }
    const going: Drawn[] = [];
    for (const square of leaving) {
      const at = 1 - eased(fadeAt(now - (square.gone ?? now), leaveMs()));
      if (at <= 0) {
        drop(square);
        continue;
      }
      dim(square, at, now);
      going.push(square);
      busy = true;
    }
    leaving = going;
    return busy;
  };

  /** Keep drawing while anything is moving, and stop the moment nothing is. A
   *  scene here renders on demand, so a loop left running is a frame a second
   *  forever for nothing. */
  const step = () => {
    frame = null;
    const busy = apply(performance.now());
    handle.render();
    if (busy) frame = requestAnimationFrame(step);
  };

  const clear = () => {
    if (frame !== null && animates) cancelAnimationFrame(frame);
    frame = null;
    for (const square of drawn.values()) drop(square);
    for (const square of leaving) drop(square);
    drawn = new Map();
    leaving = [];
  };

  return {
    root,
    draw: (marks, as = "standing", selected = null) => {
      const now = performance.now();
      // Two buildings of one def can stand on one patch of ground, which is a
      // clash rather than an impossibility, so a name that is already taken
      // gets a number after it.
      const taken = new Map<string, number>();
      const names = marks.map((mark) => {
        const name = markName(mark);
        const seen = taken.get(name) ?? 0;
        taken.set(name, seen + 1);
        return seen === 0 ? name : `${name}#${seen}`;
      });

      const { left } = arrivals(drawn.keys(), names);
      for (const name of left) {
        const square = drawn.get(name);
        drawn.delete(name);
        if (!square) continue;
        if (leaveMs() <= 0) drop(square);
        else {
          square.gone = now;
          square.pulsing = null;
          leaving.push(square);
        }
      }

      const next = new Map<string, Drawn>();
      marks.forEach((mark, at) => {
        const name = names[at];
        // Rebuilt rather than compared, because a redraw can have changed
        // anything about it. What survives is when it arrived, so a redraw is
        // not an arrival.
        const had = drawn.get(name);
        if (had) drop(had);
        const square = buildMark(
          mark,
          as,
          mark.key === selected,
          had?.born ?? now,
        );
        root.add(square.group);
        next.set(name, square);
      });
      drawn = next;

      const busy = apply(now);
      handle.render();
      if (busy && animates && frame === null)
        frame = requestAnimationFrame(step);
    },
    dispose: () => {
      clear();
      root.removeFromParent();
    },
  };
}
