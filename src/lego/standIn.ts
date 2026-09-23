/**
 * A crude, inert second unit for the model editor to aim at, build and carry.
 *
 * A sibling of `referenceObject.ts` rather than a mode of it. The reference
 * figure is a real game unit and exists to judge scale against. This is a
 * shape with no game behind it, and exists so that an animation has something
 * to be about. An aim that is right and an aim that is wrong look the same
 * against an empty scene.
 *
 * It knows nothing about scripts. A scenario says where it goes, the viewport
 * puts it there, and `aimResolver.ts` works out what the unit should be told
 * about it.
 */

import * as THREE from "three";
import type { UnitBounds } from "./s3oBuild";
import {
  type ScriptOutput,
  STAND_IN_UNIT_ID,
  type StandInAttach,
  type StandInKey,
  type StandInTrack,
} from "./scriptPlayback";

type Vec3 = [number, number, number];

/**
 * How big the stand-in is beside the unit being edited: a fifth or so of the
 * unit's wider horizontal extent.
 *
 * Judged by looking rather than derived. A fixed size is a speck beside a
 * factory and a wall beside a scout, and the point of the thing is that it
 * reads as another unit. It was a third until it was watched on screen, where
 * it crowded the unit it is meant to be a target for.
 *
 * A track's positions are multiples of this too, so a stand-in that shrinks
 * also stands proportionally nearer. That is deliberate: the two together are
 * what make one track serve a scout and a factory alike.
 */
const RADIUS_FRACTION = 7 / 30;
/** The smallest it goes, in elmos, so a unit with almost nothing built yet
 *  still has something visible to aim at. */
const MIN_RADIUS = 4.2;
/** The largest, so the biggest factory in a game gets a target rather than a
 *  second building. */
const MAX_RADIUS = 28;

/**
 * How high the stand-in's middle is above its base, in multiples of its
 * radius.
 *
 * A track's positions say where the stand-in stands, so `y: 0` sits it on the
 * ground exactly as the engine stands a unit on `y = 0`. What a weapon aims at
 * is the unit's middle, so this is what the resolver adds. Half the height the
 * shape in `buildStandIn` is built to.
 */
export const STAND_IN_MID_Y = 0.55;

/** How big the stand-in beside this unit should be, in elmos. `size` stands
 *  in for `RADIUS_FRACTION` where a scenario's track sets one, before the
 *  clamps are applied, so the clamps still mean the same thing at either
 *  end. */
export function standInRadius(bounds: UnitBounds, size?: number): number {
  const across =
    Math.max(bounds.sizeX, bounds.sizeZ) * (size ?? RADIUS_FRACTION);
  return Math.min(Math.max(across, MIN_RADIUS), MAX_RADIUS);
}

/** Where the stand-in is on one frame, in elmos, and which way it faces. */
export interface StandInPose {
  /** Unit-local, in elmos. Measured from where the stand-in was last let go
   *  when `fromRelease` says so, and from the unit's origin otherwise. */
  pos: Vec3;
  /** Radians about the vertical axis, relative to the unit's facing. */
  heading: number;
  fromRelease: boolean;
}

/**
 * Where a track puts the stand-in on one frame.
 *
 * Keys interpolate linearly. A frame outside the track holds the nearest key
 * rather than extrapolating past it, because a scenario that stops asking for
 * something has stopped asking, and a stand-in sliding out of the scene at the
 * end of a preview would be a bug that looks like a feature.
 */
export function standInAt(
  track: StandInTrack,
  frame: number,
  radius: number,
): StandInPose | null {
  const { keys } = track;
  if (keys.length === 0) return null;

  const first = keys[0];
  if (frame <= first.frame) return posed(first, radius);
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return posed(last, radius);

  for (let i = 1; i < keys.length; i++) {
    const to = keys[i];
    if (frame > to.frame) continue;
    const from = keys[i - 1];
    const span = to.frame - from.frame;
    // Two keys on the same frame: the later one wins, as the loop's own
    // ordering already implies, rather than dividing by nothing.
    const t = span === 0 ? 1 : (frame - from.frame) / span;
    return {
      pos: [
        mix(from.pos[0], to.pos[0], t) * radius,
        mix(from.pos[1], to.pos[1], t) * radius,
        mix(from.pos[2], to.pos[2], t) * radius,
      ],
      heading: mix(from.heading ?? 0, to.heading ?? 0, t),
      // The key being moved towards, since that is the one that says where the
      // motion ends up. Tracks never mix the two origins mid-move.
      fromRelease: to.fromRelease ?? false,
    };
  }
  return posed(last, radius);
}

function posed(key: StandInKey, radius: number): StandInPose {
  return {
    pos: [key.pos[0] * radius, key.pos[1] * radius, key.pos[2] * radius],
    heading: key.heading ?? 0,
    fromRelease: key.fromRelease ?? false,
  };
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** The attachment in force on a frame, or null when the stand-in is loose. */
export function attachedAt(
  track: StandInTrack,
  frame: number,
): StandInAttach | null {
  const attach = track.attach;
  if (!attach) return null;
  if (frame < attach.frame) return null;
  if (attach.until !== null && frame >= attach.until) return null;
  return attach;
}

/** Where the script's own attach and drop events leave the stand-in. */
export type PassengerState =
  | { kind: "loose" }
  | { kind: "riding"; piece: string }
  | { kind: "void" }
  /** `from` is the piece it rode until it was let go, or null out of the void. */
  | { kind: "released"; frame: number; from: string | null };

/**
 * Fold a run's attach and drop events up to `frame` into where they leave the
 * stand-in.
 *
 * An event on its own frame counts, because the engine moves a passenger within
 * the frame it was attached (`rts/Game/Game.cpp:1796-1798`). Events about any
 * other unit id change nothing, and neither does a drop of a stand-in nobody is
 * carrying (`rts/Sim/Units/Unit.cpp:2715-2720`).
 */
export function passengerAt(
  events: ScriptOutput[],
  frame: number,
): PassengerState {
  let state: PassengerState = { kind: "loose" };
  for (const event of events) {
    if (event.frame > frame) break;
    if (event.kind !== "attach" && event.kind !== "drop") continue;
    if (event.unit !== STAND_IN_UNIT_ID) continue;
    if (event.kind === "attach") {
      state =
        event.piece === null
          ? { kind: "void" }
          : { kind: "riding", piece: event.piece };
    } else if (state.kind === "riding" || state.kind === "void") {
      state = {
        kind: "released",
        frame: event.frame,
        from: state.kind === "riding" ? state.piece : null,
      };
    }
  }
  return state;
}

/**
 * Where a track puts the stand-in after it was let go, in elmos.
 *
 * The release point is an implicit key on the drop's frame, and keys after it
 * interpolate from there. Keys at or before the drop are passed over, because
 * the runtime owned the stand-in while it was carried. A `fromRelease` key is
 * measured from the release point. The implicit key faces the way the unit
 * does, because a carried unit takes its transporter's heading
 * (`rts/Sim/Units/Unit.cpp:734-748`), which is 0 in the editor.
 *
 * A stand-in let go holds where it was put down and does not fall. Falling
 * belongs to the move type, which the preview does not have.
 *
 * Known gap, recorded rather than designed for: a return leg keyed after a drop
 * walks the stand-in back while the runtime still answers the release point,
 * because no call-in fires during a return leg.
 */
export function standInAfterRelease(
  track: StandInTrack,
  frame: number,
  release: { frame: number; at: Vec3 },
  radius: number,
): { pos: Vec3; heading: number } {
  const place = (key: StandInKey): Vec3 => {
    const from = key.fromRelease ? release.at : [0, 0, 0];
    return [
      from[0] + key.pos[0] * radius,
      from[1] + key.pos[1] * radius,
      from[2] + key.pos[2] * radius,
    ];
  };
  let from = { frame: release.frame, pos: release.at, heading: 0 };
  for (const key of track.keys) {
    if (key.frame <= release.frame) continue;
    const to = { frame: key.frame, pos: place(key), heading: key.heading ?? 0 };
    if (frame <= to.frame) {
      const span = to.frame - from.frame;
      const t = span === 0 ? 1 : (frame - from.frame) / span;
      return {
        pos: [
          mix(from.pos[0], to.pos[0], t),
          mix(from.pos[1], to.pos[1], t),
          mix(from.pos[2], to.pos[2], t),
        ],
        heading: mix(from.heading, to.heading, t),
      };
    }
    from = to;
  }
  return { pos: from.pos, heading: from.heading };
}

/**
 * Neutral grey. Every other colour in this scene means something specific -
 * violet is selection, orange is the collision volume, red is the aim point,
 * sky blue is the reference figure - and the stand-in is a unit rather than a
 * reading about one, so it takes none of them.
 */
const BODY_COLOUR = 0x9ca3af;
/**
 * The nose facet. Teal is the one place on the wheel nothing in this scene
 * already occupies, and it is what says which way the thing is facing from any
 * angle the silhouette alone does not.
 */
const NOSE_COLOUR = 0x14b8a6;

/** How tall the shape is, in multiples of its radius. `STAND_IN_MID_Y` is half
 *  this, which is where its middle sits. */
const HEIGHT = STAND_IN_MID_Y * 2;

/** How tall the stand-in is, in elmos, which is what the engine calls a
 *  unit's height. */
export function standInHeight(radius: number): number {
  return HEIGHT * radius;
}

/** How far past the radius the nose reaches, in multiples of the radius. What
 *  makes a shape seen from behind different from one seen in front. */
const NOSE_REACH = 1.35;

/** The panel texture's own size in pixels, and how many elmos one tile covers.
 *  Small and plain on purpose: flat shading is what makes the facets readable,
 *  and a busy texture fights it. */
const PANEL_PIXELS = 64;
const PANEL_ELMOS = 4;

/**
 * The stand-in, in its own local space with its base on y = 0, as the engine
 * stands a unit.
 *
 * Purely a visual aid. It never carries a piece, is never selected, hovered,
 * baked or exported. The viewport positions and toggles it. This only builds
 * the shape.
 */
export function buildStandIn(radius: number): THREE.Group {
  const group = new THREE.Group();
  const texture = panelTexture();

  const body = new THREE.MeshStandardMaterial({
    color: BODY_COLOUR,
    map: texture,
    flatShading: true,
    roughness: 0.75,
    metalness: 0.05,
  });
  const nose = new THREE.MeshStandardMaterial({
    color: NOSE_COLOUR,
    map: texture,
    flatShading: true,
    roughness: 0.55,
    metalness: 0.05,
  });

  const mesh = new THREE.Mesh(standInGeometry(radius), [body, nose]);
  mesh.raycast = () => {};
  group.add(mesh);
  return group;
}

/**
 * A chamfered box whose front face rakes back from the base, with a shallow
 * roof ridge running front to back.
 *
 * The rake is a tank's glacis plate. Facing reads from the slope and from the
 * direction the ridge runs, up reads from the ridge itself.
 *
 * Chosen over the other candidate by looking at both in the viewport from a
 * low rear angle, which is the case that separates them. That other one was a
 * squat eight-sided prism with a domed top and one vertex pushed forward, and
 * it read as a rock: the dome took away any flat deck to judge "up" against,
 * and one pushed vertex out of eight is not a visible point, so only the
 * coloured facet said which way it faced. A colour doing the work the
 * silhouette is supposed to do is the thing being avoided here.
 */
function standInGeometry(radius: number): THREE.BufferGeometry {
  const h = HEIGHT * radius;
  const x = radius;
  const back = -radius;
  const front = radius * NOSE_REACH;

  // The deck, narrower and shorter than the base, with the front edge pulled
  // well back so the nose is a long slope rather than a wall.
  const dx = x * 0.72;
  const deckFront = radius * 0.35;
  const deckY = h * 0.75;
  // The ridge, one line down the middle of the deck.
  const ridgeY = h;

  const p = {
    baseBL: [-x, 0, back] as Vec3,
    baseBR: [x, 0, back] as Vec3,
    baseFL: [-x, 0, front] as Vec3,
    baseFR: [x, 0, front] as Vec3,
    deckBL: [-dx, deckY, back * 0.9] as Vec3,
    deckBR: [dx, deckY, back * 0.9] as Vec3,
    deckFL: [-dx, deckY, deckFront] as Vec3,
    deckFR: [dx, deckY, deckFront] as Vec3,
    ridgeB: [0, ridgeY, back * 0.75] as Vec3,
    ridgeF: [0, ridgeY, deckFront * 0.6] as Vec3,
  };

  const body: number[] = [];
  const noseFaces: number[] = [];

  // Every triangle below is wound so its own normal points out of the shape.
  // `the stand-in's winding` in the tests holds this, because a face wound the
  // other way is culled and what shows through the hole is the inside of the
  // far side, which reads as a solid shape with its colours misplaced rather
  // than as a bug.

  // The base, facing down.
  body.push(...p.baseBL, ...p.baseFR, ...p.baseFL);
  body.push(...p.baseBL, ...p.baseBR, ...p.baseFR);
  // The glacis: base front edge up to the deck front edge. The nose facet.
  noseFaces.push(...p.baseFL, ...p.deckFR, ...p.deckFL);
  noseFaces.push(...p.baseFL, ...p.baseFR, ...p.deckFR);
  // The back.
  body.push(...p.baseBR, ...p.deckBL, ...p.deckBR);
  body.push(...p.baseBR, ...p.baseBL, ...p.deckBL);
  // The left and right skirts.
  body.push(...p.baseBL, ...p.deckFL, ...p.deckBL);
  body.push(...p.baseBL, ...p.baseFL, ...p.deckFL);
  body.push(...p.baseFR, ...p.deckBR, ...p.deckFR);
  body.push(...p.baseFR, ...p.baseBR, ...p.deckBR);
  // The roof: four faces up to the ridge, plus its two ends.
  body.push(...p.deckFL, ...p.ridgeF, ...p.ridgeB);
  body.push(...p.deckFL, ...p.ridgeB, ...p.deckBL);
  body.push(...p.deckFR, ...p.deckBR, ...p.ridgeB);
  body.push(...p.deckFR, ...p.ridgeB, ...p.ridgeF);
  body.push(...p.deckFL, ...p.deckFR, ...p.ridgeF);
  body.push(...p.deckBL, ...p.ridgeB, ...p.deckBR);

  return grouped(body, noseFaces);
}

/**
 * One geometry in two material groups: the body, then the nose facet.
 *
 * Non-indexed and with normals computed per triangle, which is what flat
 * shading needs. Shared vertices would average the normals across a facet and
 * smooth away the very edges that make the shape readable.
 */
function grouped(body: number[], nose: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([...body, ...nose], 3),
  );
  geometry.computeVertexNormals();
  geometry.addGroup(0, body.length / 3, 0);
  geometry.addGroup(body.length / 3, nose.length / 3, 1);
  // Box-projected on x and z, in elmos, so the panels stay the same size on a
  // stand-in built for a scout and one built for a factory.
  const pos = geometry.getAttribute("position");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / PANEL_ELMOS;
    uv[i * 2 + 1] = (pos.getZ(i) + pos.getY(i)) / PANEL_ELMOS;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/**
 * A small tiling grey panel pattern: panel lines on a light base, with a little
 * grain.
 *
 * Not a stone or metal photograph. Flat shading is what makes the facets
 * readable and a busy texture fights it, so this is enough to say "made of
 * something" and no more. Follows `environment.ts` for the canvas-less path,
 * since the tests run without a DOM.
 */
function panelTexture(): THREE.CanvasTexture | null {
  const canvas =
    typeof document === "undefined" ? null : document.createElement("canvas");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return null;

  canvas.width = PANEL_PIXELS;
  canvas.height = PANEL_PIXELS;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PANEL_PIXELS, PANEL_PIXELS);

  context.strokeStyle = "rgba(0, 0, 0, 0.22)";
  context.lineWidth = 1;
  const step = PANEL_PIXELS / 2;
  for (let at = 0; at <= PANEL_PIXELS; at += step) {
    context.beginPath();
    context.moveTo(at + 0.5, 0);
    context.lineTo(at + 0.5, PANEL_PIXELS);
    context.moveTo(0, at + 0.5);
    context.lineTo(PANEL_PIXELS, at + 0.5);
    context.stroke();
  }

  const image = context.getImageData(0, 0, PANEL_PIXELS, PANEL_PIXELS);
  for (let i = 0; i < image.data.length; i += 4) {
    const grain = Math.round((Math.random() - 0.5) * 18);
    image.data[i] += grain;
    image.data[i + 1] += grain;
    image.data[i + 2] += grain;
  }
  context.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Frees the geometry, materials and texture `buildStandIn` allocated. */
export function disposeStandIn(group: THREE.Group): void {
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    child.geometry.dispose();
    for (const material of [child.material].flat()) {
      (material as THREE.MeshStandardMaterial).map?.dispose();
      material.dispose();
    }
  }
}
