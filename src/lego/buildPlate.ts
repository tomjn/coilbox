/**
 * The ground the builder works on: a grid in elmos, marked up with the
 * footprint sizes real units are built at.
 *
 * A plain 1-elmo grid tells you how far you have moved a piece but nothing
 * about how big the unit is getting, and parts are small enough that a unit can
 * look substantial while being a fraction of a solar collector. So the ground
 * carries three readings at once:
 *
 * - Fine lines every elmo, near the origin where pieces are placed.
 * - Heavier lines every footprint step, the 16 elmos the engine reserves ground
 *   in (`ELMOS_PER_FOOTPRINT`), out to the far edge.
 * - Plates at the origin for the footprints units are commonly built at, each
 *   with its size written in the corner, so "does this fit a 3 by 3" is a thing
 *   you can see rather than work out.
 *
 * The plates are flat translucent bands rather than lines. One-pixel lines
 * shimmer as the camera moves, and a WebGL line is one pixel whatever
 * `linewidth` says, so anything thicker has to be geometry. Bands lie on the
 * ground, so they read as markings on it rather than as objects, and each
 * plate's size is written on it the same way.
 *
 * Sizes are elmos throughout, as everywhere else in the builder: see
 * `referenceObject.ts` for why nothing is rescaled between here and an export.
 */

import * as THREE from "three";

import {
  REFERENCE_FOOTPRINT_STEPS,
  REFERENCE_WIDTH_ELMOS,
} from "./referenceObject";
import { ELMOS_PER_FOOTPRINT } from "./unitDef";

/** How far the ground reaches from the origin, in footprint steps each way.
 *  Wide enough to hold the reference unit with room to spare, because a unit
 *  that fits inside the old 40-elmo grid is easy to mistake for a big one. */
const GROUND_STEPS = 10;

/** The full width of the ground, in elmos. */
export const GROUND_ELMOS = GROUND_STEPS * 2 * ELMOS_PER_FOOTPRINT;

/** How far the 1-elmo grid reaches. Short of the ground's edge on purpose:
 *  every elmo across the whole ground is a shimmering mess when zoomed out, and
 *  pieces are built near the origin anyway. */
const FINE_ELMOS = 4 * 2 * ELMOS_PER_FOOTPRINT;

/**
 * Footprints to mark, in steps. 1 by 1 is the engine's minimum, 2 by 2 and 3 by
 * 3 cover most turrets and small buildings, and the largest is the reference
 * unit's own footprint, so the plate under the unit being built and the solar
 * collector standing beside it are the same reading.
 */
export const PLATE_FOOTPRINTS = [1, 2, 3, REFERENCE_FOOTPRINT_STEPS] as const;

/** The largest plate, in elmos: the one everything else has to keep clear of. */
const LARGEST_PLATE_ELMOS = Math.max(...PLATE_FOOTPRINTS) * ELMOS_PER_FOOTPRINT;

/**
 * Where the viewport parks the reference unit: to the left, half a footprint
 * step outside the largest plate. Clear of the markings, because a solar
 * collector standing on the plates hides the numbers, and no further out than
 * that, because a reference you have to go looking for is one nobody uses.
 *
 * Takes the figure's width because the figure can be a unit read out of an
 * installed game, which is any size at all. A wide one parks further left so
 * its near edge lands in the same place the solar collector's does.
 */
export function referenceParkX(widthElmos: number): number {
  return -(LARGEST_PLATE_ELMOS / 2 + ELMOS_PER_FOOTPRINT / 2 + widthElmos / 2);
}

/** Where the built-in reference unit parks. */
export const REFERENCE_PARK_X = referenceParkX(REFERENCE_WIDTH_ELMOS);

const FINE_COLOUR = 0x2c333f;
const STEP_COLOUR = 0x556070;
const PLATE_COLOUR = 0x8f9bad;

/** Translucent throughout, so the markings sit under the unit rather than
 *  competing with it. */
const GRID_OPACITY = 0.45;
const PLATE_OPACITY = 0.5;

/** A hair above the grid, so the plates are not fighting it for the same
 *  pixels, and low enough to stay under anything built on the ground. */
const PLATE_Y = 0.02;

/** How wide a plate's band is, in elmos. The same on every plate, so all the
 *  markings read as one weight of line. */
const BAND = 0.35;

/** A plate's label, sized as a fraction of that plate's width, so it is the
 *  same size relative to its own plate whether you are reading the 1 by 1 or the
 *  5 by 5. The gap from the plate's corner follows from the label's height. */
const LABEL_SCALE = 0.07;
const LABEL_GAP_SCALE = 0.5;
const LABEL_COLOUR = 0xc7d0dd;
const LABEL_OPACITY = 0.75;

/** How tall the label is drawn on its canvas. Bigger than it needs to be at any
 *  sane zoom, because the ground is read at a grazing angle and a texture that
 *  is short of pixels there turns to mush. */
const LABEL_PIXELS = 96;

/**
 * The ground plane, in its own group: grids and plate markings only, nothing
 * that can be selected, hovered or exported. The viewport adds it once and
 * toggles the group's visibility.
 */
export function buildGround(): THREE.Group {
  const group = new THREE.Group();
  group.add(grid(FINE_ELMOS, FINE_ELMOS, FINE_COLOUR));
  group.add(grid(GROUND_ELMOS, GROUND_STEPS * 2, STEP_COLOUR));

  const material = new THREE.MeshBasicMaterial({
    color: PLATE_COLOUR,
    transparent: true,
    opacity: PLATE_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (const footprint of PLATE_FOOTPRINTS) {
    const plate = new THREE.Mesh(
      plateBand(footprint * ELMOS_PER_FOOTPRINT),
      material,
    );
    plate.name = `plate-${footprint}`;
    group.add(plate);

    const label = plateLabel(footprint);
    label.name = `plate-label-${footprint}`;
    group.add(label);
  }

  for (const child of group.children) child.raycast = () => {};
  return group;
}

function grid(
  elmos: number,
  divisions: number,
  colour: number,
): THREE.GridHelper {
  const helper = new THREE.GridHelper(elmos, divisions, colour, colour);
  const material = helper.material as THREE.Material;
  material.transparent = true;
  material.opacity = GRID_OPACITY;
  return helper;
}

/** A square band, centred on the origin and lying on the ground. */
function plateBand(elmos: number): THREE.BufferGeometry {
  const half = elmos / 2;
  const shape = new THREE.Shape(corners(half));
  // A hole has to wind the other way round from the shape it is cut from.
  shape.holes.push(new THREE.Path(corners(half - BAND).reverse()));
  return flatten(new THREE.ShapeGeometry(shape));
}

function corners(half: number): THREE.Vector2[] {
  return [
    new THREE.Vector2(-half, -half),
    new THREE.Vector2(half, -half),
    new THREE.Vector2(half, half),
    new THREE.Vector2(-half, half),
  ];
}

/**
 * A plate's size written out, "3x3", on a quad lying in the corner nearest the
 * camera's left. Text drawn on a canvas rather than built out of geometry, so it
 * is real typography at any size.
 */
function plateLabel(footprint: number): THREE.Mesh {
  const elmos = footprint * ELMOS_PER_FOOTPRINT;
  const height = elmos * LABEL_SCALE;
  const drawn = drawLabel(`${footprint}x${footprint}`);
  const width = height * drawn.aspect;

  const geometry = flatten(new THREE.PlaneGeometry(width, height));
  // Inside the plate's own band. `flatten` turns the quad's y into the ground's
  // negative z, so the corner at positive z is at negative y before that.
  const gap = BAND + height * LABEL_GAP_SCALE;
  geometry.translate(
    -elmos / 2 + gap + width / 2,
    0,
    elmos / 2 - gap - height / 2,
  );

  const material = new THREE.MeshBasicMaterial({
    color: LABEL_COLOUR,
    map: drawn.texture,
    transparent: true,
    opacity: LABEL_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

/**
 * Draw a label into a canvas texture, sized to the text so the quad carrying it
 * has no dead margin. Returns no texture where there is no canvas to draw on,
 * which is the unit tests: they run without a DOM and check where the labels are
 * rather than what they say.
 */
function drawLabel(text: string): {
  texture: THREE.CanvasTexture | null;
  aspect: number;
} {
  const canvas =
    typeof document === "undefined" ? null : document.createElement("canvas");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return { texture: null, aspect: text.length * 0.6 };

  const font = `600 ${LABEL_PIXELS}px ui-sans-serif, system-ui, sans-serif`;
  context.font = font;
  canvas.width = Math.ceil(context.measureText(text).width);
  canvas.height = Math.ceil(LABEL_PIXELS * 1.25);
  // Resizing a canvas resets its context, the font included.
  context.font = font;
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The ground is read at a grazing angle, where a texture without this is a
  // smear. 8 is what drivers commonly cap at anyway.
  texture.anisotropy = 8;
  return { texture, aspect: canvas.width / canvas.height };
}

/**
 * Lay a shape built in x and y down onto the ground. Rotating rather than
 * building in x and z keeps the labels the right way up: the shape's own up
 * becomes north, which is up the screen from where the camera starts.
 */
function flatten(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, PLATE_Y, 0);
  return geometry;
}

/**
 * Which way the unit faces, and the colour it is drawn in: the same blue the
 * viewport's axis compass draws `+z` in, so the two agree about which axis
 * this is rather than introducing a colour of its own.
 */
const FRONT_COLOUR = 0x60a5fa;
const FRONT_OPACITY = 0.85;

/** Where the front marker starts, in elmos: exactly where the viewport's own
 *  `THREE.AxesHelper(2)` arm ends, so the two do not draw over each other. */
const FRONT_ARROW_START = 2;
/** Where the shaft gives way to the arrowhead. */
const FRONT_ARROW_HEAD_START = 5;
/** The tip, landing on the `1x1` plate's edge: the smallest footprint marked,
 *  so the arrow reads as pointing at something rather than trailing into
 *  empty ground. */
const FRONT_ARROW_TIP = ELMOS_PER_FOOTPRINT / 2;
const FRONT_ARROW_SHAFT_WIDTH = 0.5;
const FRONT_ARROW_HEAD_WIDTH = 1.2;

/** The label past the tip: how far clear of it, and how tall. Sized against
 *  the same scale the plate labels read at, rather than the plate's own
 *  footprint, because this marker is not tied to any one footprint. */
const FRONT_LABEL_GAP = 0.6;
const FRONT_LABEL_HEIGHT = 1.4;

/**
 * Marks the unit's front on the ground: an arrow along model `+z`, with the
 * word "front" written past its tip.
 *
 * Pinned by the headless engine run on issue #565: model `+z` is what
 * `Spring.GetUnitVectors` calls `frontdir`, `+y` is up, and `+x` is the
 * unit's left, being the negative of `rightdir`. None of that is obvious
 * from the axes helper alone, and getting it wrong means a unit built
 * entirely backwards, found out only once it is in a game.
 *
 * Always visible, unlike the grid and the axes helper it sits beside. Those
 * are decluttering toggles for markings a builder can always re-derive by
 * looking at the unit. This is the one fact in the scene that cannot be
 * checked at all once it is missed, so it does not earn a toggle to forget.
 */
export function buildFrontMarker(): THREE.Group {
  const group = new THREE.Group();

  const arrowMaterial = new THREE.MeshBasicMaterial({
    color: FRONT_COLOUR,
    transparent: true,
    opacity: FRONT_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const arrow = new THREE.Mesh(frontArrowGeometry(), arrowMaterial);
  arrow.name = "front-arrow";
  group.add(arrow);

  group.add(frontLabel());

  for (const child of group.children) child.raycast = () => {};
  return group;
}

/**
 * A flat chevron built straight in world `x`/`z`, rather than through
 * `flatten`'s xy-plane-then-rotate route. That route exists to keep text
 * drawn on a canvas the right way up, which does not apply to a shape with
 * no "up" of its own, and an arrow's direction is exactly the kind of thing
 * a sign-flip in a rotation would get backwards without anyone noticing.
 */
function frontArrowGeometry(): THREE.BufferGeometry {
  const halfShaft = FRONT_ARROW_SHAFT_WIDTH / 2;
  const halfHead = FRONT_ARROW_HEAD_WIDTH / 2;

  // Two triangles for the shaft, one for the head, wound so the visible
  // face looks up. `DoubleSide` makes the winding immaterial to rendering,
  // but a consistent one matches every other flat mesh this file builds.
  // biome-ignore format: laid out one vertex per line, in triangles, reads
  // as the shape rather than as a wall of numbers.
  const vertices = [
    -halfShaft, PLATE_Y, FRONT_ARROW_START,
     halfShaft, PLATE_Y, FRONT_ARROW_START,
     halfShaft, PLATE_Y, FRONT_ARROW_HEAD_START,

    -halfShaft, PLATE_Y, FRONT_ARROW_START,
     halfShaft, PLATE_Y, FRONT_ARROW_HEAD_START,
    -halfShaft, PLATE_Y, FRONT_ARROW_HEAD_START,

    -halfHead, PLATE_Y, FRONT_ARROW_HEAD_START,
     halfHead, PLATE_Y, FRONT_ARROW_HEAD_START,
             0, PLATE_Y, FRONT_ARROW_TIP,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  return geometry;
}

/** The word "front", past the arrow's tip. Built the same way as a plate's
 *  label: text drawn on a canvas so it is real typography at any size, laid
 *  flat with `flatten`, which is exactly the xy-plane-then-rotate route the
 *  arrow avoids, because text has an "up" that has to survive the rotation
 *  and a plain quad has no direction of its own to get backwards. */
function frontLabel(): THREE.Mesh {
  const drawn = drawLabel("front");
  const width = FRONT_LABEL_HEIGHT * drawn.aspect;

  const geometry = flatten(new THREE.PlaneGeometry(width, FRONT_LABEL_HEIGHT));
  geometry.translate(
    0,
    0,
    FRONT_ARROW_TIP + FRONT_LABEL_GAP + FRONT_LABEL_HEIGHT / 2,
  );

  const material = new THREE.MeshBasicMaterial({
    color: FRONT_COLOUR,
    map: drawn.texture,
    transparent: true,
    opacity: FRONT_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "front-label";
  return mesh;
}

/** Frees the geometry and materials `buildFrontMarker` allocated. */
export function disposeFrontMarker(group: THREE.Group): void {
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    child.geometry.dispose();
    const material = child.material as THREE.MeshBasicMaterial;
    material.map?.dispose();
    material.dispose();
  }
}

/** Frees the geometry and materials `buildGround` allocated. */
export function disposeGround(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.GridHelper) {
      child.dispose();
      continue;
    }
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      // Every plate shares one material, so this frees that one repeatedly.
      // Disposing an already disposed material is a no-op in Three.js. Each
      // label has its own, because each carries its own canvas.
      const material = child.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
    }
  }
}
