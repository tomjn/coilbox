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
 * Nothing here carries a `placementKey` and the layer is not handed to
 * `useMapEditing`, so a footprint cannot be clicked. It lies under the building
 * it belongs to and would otherwise swallow every click meant for that building.
 *
 * The arithmetic is `@/blueprint/footprint`, which is tested. This file is the
 * drawing.
 */

import * as THREE from "three";

import { type FootprintMark, unjudged } from "@/blueprint/footprint";
import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import type { Point } from "@/scenario/model";
import { worldToScene } from "./scene";

/** What the footprints are drawn under, so they can be found and removed as one
 *  thing. */
const ROOT_NAME = "scenario-footprints";

/** How far above the ground a footprint sits, in elmos. The same clearance the
 *  zones take, for the same reason: the relief is drawn by a shader the layer
 *  only samples. */
const LIFT_ELMOS = 4;

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

/** What a building in the wrong depth of water is drawn in (issue #1459). Its
 *  own colour because it is fixed its own way: this one moves to the water, or
 *  out of it, and no amount of flatter ground helps. */
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
 *  was, because it is saying what the ring said: this is the one you have. */
const HELD_COLOR = 0x7dd3fc;

/** The dashes of that outline, in elmos. A build square is 16, so a dash and a
 *  gap fall inside the smallest footprint there is. */
const DASH_ELMOS = 7;
const GAP_ELMOS = 5;

/** How one footprint is drawn. */
export interface FootprintStyle {
  color: number;
  /** How solid the patch is. Zero draws no patch at all. */
  fill: number;
  outline: number;
  /** A dashed outline, which is what says nothing judged this building. */
  dashed: boolean;
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
 * `held` is the building the pointer is carrying (issue #1512). It is the same
 * three states said louder: a refusal keeps its own colour, because red is the
 * answer to where this is being dropped and being held cannot paint over it,
 * and a building nothing has judged keeps its empty dashed square, because the
 * shape is the statement. Only the state with nothing to say takes a colour of
 * its own, which is the one thing the selection ring was for.
 */
export function footprintStyle(
  mark: Pick<FootprintMark, "overlapping" | "standing">,
  held = false,
): FootprintStyle {
  const fill = held ? 0.45 : 0.32;
  const outline = held ? 1 : 0.95;
  if (mark.overlapping) {
    return { color: CLASH_COLOR, fill, outline, dashed: false };
  }
  if (mark.standing === "slope") {
    return { color: SLOPE_COLOR, fill, outline, dashed: false };
  }
  if (mark.standing === "depth") {
    return { color: DEPTH_COLOR, fill, outline, dashed: false };
  }
  if (mark.standing === "no-def") {
    return { color: ABSENT_COLOR, fill, outline, dashed: false };
  }
  if (unjudged(mark.standing)) {
    return {
      color: held ? HELD_COLOR : UNJUDGED_COLOR,
      fill: 0,
      outline: held ? 1 : 0.8,
      dashed: true,
    };
  }
  return held
    ? { color: HELD_COLOR, fill: 0.3, outline: 1, dashed: false }
    : { color: GROUND_COLOR, fill: 0.12, outline: 0.55, dashed: false };
}

export interface FootprintsLayerDeps {
  handle: MapScene3D;
  /** Map extent in elmos, as `useMissionMapAssets` reports it. */
  worldWidth: number;
  worldHeight: number;
  /** The map's ground height in elmos at an engine position. */
  groundAt: (pos: Point) => number;
}

export interface FootprintsLayer {
  root: THREE.Group;
  /** Draw this list, replacing whatever was drawn before. `held` draws them as
   *  the building the pointer is carrying rather than as ground being stood
   *  on. */
  draw: (marks: FootprintMark[], held?: boolean) => void;
  dispose: () => void;
}

/**
 * The outline of a footprint, in elmos around its middle.
 *
 * The first corner is repeated rather than the loop being closed by a
 * `LineLoop`, because a dashed line needs `computeLineDistances` and that only
 * measures the segments a geometry actually holds. A loop's closing edge is not
 * one of them, so it would come out solid.
 */
function corners(width: number, depth: number): THREE.Vector3[] {
  const x = width / 2;
  const z = depth / 2;
  return [
    new THREE.Vector3(-x, 0, -z),
    new THREE.Vector3(x, 0, -z),
    new THREE.Vector3(x, 0, z),
    new THREE.Vector3(-x, 0, z),
    new THREE.Vector3(-x, 0, -z),
  ];
}

export function createFootprintsLayer(
  deps: FootprintsLayerDeps,
): FootprintsLayer {
  const { handle } = deps;
  const root = new THREE.Group();
  root.name = ROOT_NAME;
  handle.scene.add(root);

  /** Everything one pass allocated, so the next pass can free it. Each footprint
   *  is its own size, so there is nothing to share between two of them. */
  let owned: { dispose: () => void }[] = [];

  const buildMark = (mark: FootprintMark, held: boolean): THREE.Group => {
    const style = footprintStyle(mark, held);
    const width = mark.rect.maxX - mark.rect.minX;
    const depth = mark.rect.maxZ - mark.rect.minZ;
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

    // The patch itself is depth tested, so a hill in front of it hides it the
    // way it hides the building standing on it. A building with no verdict has
    // no patch at all, so an empty square cannot be read as ground anybody has
    // approved of.
    if (style.fill > 0) {
      const fillGeometry = new THREE.PlaneGeometry(width, depth);
      fillGeometry.rotateX(-Math.PI / 2);
      const fillMaterial = new THREE.MeshBasicMaterial({
        color: style.color,
        transparent: true,
        opacity: style.fill,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      group.add(new THREE.Mesh(fillGeometry, fillMaterial));
      owned.push(fillGeometry, fillMaterial);
    }

    // The outline is not, so the shape of a building's ground can be read from
    // above with the model itself standing in the middle of it.
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(
      corners(width, depth),
    );
    const lineMaterial = style.dashed
      ? new THREE.LineDashedMaterial({
          color: style.color,
          transparent: true,
          opacity: style.outline,
          depthTest: false,
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
          depthTest: false,
        });
    const outline = new THREE.Line(lineGeometry, lineMaterial);
    // A dashed material draws solid without this, which would put a building
    // with no verdict back to looking like one that passed.
    outline.computeLineDistances();
    outline.renderOrder = 2;
    group.add(outline);

    owned.push(lineGeometry, lineMaterial);
    return group;
  };

  const clear = () => {
    root.clear();
    for (const spent of owned) spent.dispose();
    owned = [];
  };

  return {
    root,
    draw: (marks, held = false) => {
      clear();
      for (const mark of marks) root.add(buildMark(mark, held));
      handle.render();
    },
    dispose: () => {
      clear();
      root.removeFromParent();
    },
  };
}
