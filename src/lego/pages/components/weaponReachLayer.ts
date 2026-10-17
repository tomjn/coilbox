/**
 * Each weapon's range and firing arc, drawn on the ground (issue #3295).
 *
 * A ring at the range the engine tests for a unit standing on the ground,
 * centred under the aim-from piece, which is where `TestRange` measures from.
 * A weapon that cannot fire all the way round gets a wedge instead: the part
 * of the ring it covers, two edges back to the centre and a faint fill. A
 * thin line drops from the aim-from piece to the centre, so it is clear which
 * piece the ring belongs to. See `weaponReach.ts` for the engine's tests.
 *
 * Drawn over everything, like the collision wireframe, so a shaped ground or
 * the unit's own hull never hides it. Never exported.
 */

import * as THREE from "three";
import type { Vec3 } from "../../snapping";
import {
  aimFromPosition,
  levelArc,
  rangeAt,
  type WeaponReach,
} from "../../weaponReach";

/** One colour per weapon, in slot order, chosen apart from the scene's
 *  orange collision box, red aim point and violet selection. */
export const REACH_COLOURS = [
  0x22d3ee, 0xa3e635, 0xf472b6, 0xfacc15, 0x60a5fa, 0x34d399, 0xfb923c,
  0xc084fc,
];

export function reachColour(index: number): string {
  const hex = REACH_COLOURS[index % REACH_COLOURS.length];
  return `#${hex.toString(16).padStart(6, "0")}`;
}

/** Lifted off y = 0 a little, so the fill does not fight the grid. */
const LIFT = 0.05;
/** Segments in a full ring. A ring is hundreds of elmos across, so fewer
 *  shows corners. */
const RING_SEGMENTS = 128;
/** Where a full ring's label sits: towards the home camera, front left. */
const LABEL_HEADING = Math.PI / 4;
/** A label's height as a share of the view's height. */
const LABEL_HEIGHT = 0.035;

/** The point at `heading` (radians from +z towards +x) and `radius` from
 *  `centre`, on the ground. */
function onGround(centre: Vec3, heading: number, radius: number): Vec3 {
  return [
    centre[0] + Math.sin(heading) * radius,
    LIFT,
    centre[2] + Math.cos(heading) * radius,
  ];
}

function line(points: Vec3[], material: THREE.Material): THREE.Line {
  const geometry = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points.flat(), 3),
  );
  const drawn = new THREE.Line(geometry, material);
  drawn.renderOrder = 4;
  drawn.raycast = () => {};
  return drawn;
}

/** A fan from the centre over `from` to `to`, for the fill. */
function sector(
  centre: Vec3,
  radius: number,
  from: number,
  to: number,
  material: THREE.Material,
): THREE.Mesh {
  const steps = Math.max(
    2,
    Math.ceil(((to - from) / (Math.PI * 2)) * RING_SEGMENTS),
  );
  const positions: number[] = [centre[0], LIFT, centre[2]];
  for (let i = 0; i <= steps; i++) {
    positions.push(
      ...onGround(centre, from + ((to - from) * i) / steps, radius),
    );
  }
  const index: number[] = [];
  for (let i = 1; i <= steps; i++) index.push(0, i, i + 1);
  const geometry = new THREE.BufferGeometry()
    .setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    .setIndex(index);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 3;
  mesh.raycast = () => {};
  return mesh;
}

function label(text: string, colour: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const font = 28;
  const context = canvas.getContext("2d");
  const measure = () => {
    if (!context) return 0;
    context.font = `600 ${font}px system-ui, sans-serif`;
    return context.measureText(text).width;
  };
  canvas.width = Math.ceil(measure()) + 20;
  canvas.height = font + 16;
  if (context) {
    context.font = `600 ${font}px system-ui, sans-serif`;
    context.fillStyle = "rgba(0,0,0,0.6)";
    context.beginPath();
    context.roundRect(0, 0, canvas.width, canvas.height, 8);
    context.fill();
    context.fillStyle = colour;
    context.textBaseline = "middle";
    context.fillText(text, 10, canvas.height / 2 + 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      sizeAttenuation: false,
      depthTest: false,
      transparent: true,
    }),
  );
  sprite.scale.set(
    (LABEL_HEIGHT * canvas.width) / canvas.height,
    LABEL_HEIGHT,
    1,
  );
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 6;
  sprite.raycast = () => {};
  return sprite;
}

/** The label a weapon's ring carries: its name and the range it states. */
export function reachLabel(reach: WeaponReach): string {
  return `${reach.number} ${reach.name}, stated range ${Number(reach.range.toFixed(1))}`;
}

/** One weapon's ring or wedge, its drop line and its label. */
function drawReach(
  reach: WeaponReach,
  rest: Map<string, Vec3>,
  index: number,
): THREE.Group {
  const group = new THREE.Group();
  const colour = REACH_COLOURS[index % REACH_COLOURS.length];
  const lineMaterial = new THREE.LineBasicMaterial({
    color: colour,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity: 0.1,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const from = aimFromPosition(reach, rest);
  const centre: Vec3 = [from[0], LIFT, from[2]];
  // The range for a unit on the ground, `from[1]` below the aim-from piece.
  const radius = rangeAt(reach, -from[1], "unit");
  const arc = levelArc(reach.arc);
  const start = arc ? arc.centre - arc.half : 0;
  const end = arc ? arc.centre + arc.half : Math.PI * 2;

  if (radius > 0 && end > start) {
    const steps = Math.max(
      2,
      Math.ceil(((end - start) / (Math.PI * 2)) * RING_SEGMENTS),
    );
    const rim: Vec3[] = [];
    for (let i = 0; i <= steps; i++) {
      rim.push(onGround(centre, start + ((end - start) * i) / steps, radius));
    }
    group.add(line(arc ? [centre, ...rim, centre] : rim, lineMaterial));
    group.add(sector(centre, radius, start, end, fillMaterial));
  } else if (arc && radius > 0) {
    // No width at all on the level: one edge along the facing.
    group.add(
      line([centre, onGround(centre, arc.centre, radius)], lineMaterial),
    );
  }
  // Down from the piece the engine measures from.
  group.add(line([from, centre], lineMaterial));

  const tag = label(reachLabel(reach), reachColour(index));
  tag.position.set(
    ...onGround(centre, arc ? arc.centre : LABEL_HEADING, radius),
  );
  group.add(tag);
  return group;
}

/** Every weapon's drawing, in one group for the overlay. */
export function buildWeaponReach(
  reaches: WeaponReach[],
  rest: Map<string, Vec3>,
): THREE.Group {
  const group = new THREE.Group();
  reaches.forEach((reach, index) => {
    group.add(drawReach(reach, rest, index));
  });
  return group;
}

/** Free what `buildWeaponReach` made. Every geometry, material and label
 *  texture belongs to the group alone, except a sprite's geometry, which
 *  three.js shares between every sprite. */
export function disposeWeaponReach(group: THREE.Group): void {
  group.traverse((object) => {
    if (
      object instanceof THREE.Line ||
      object instanceof THREE.Mesh ||
      object instanceof THREE.Sprite
    ) {
      if (!(object instanceof THREE.Sprite)) object.geometry.dispose();
      const material = object.material as THREE.Material & {
        map?: THREE.Texture | null;
      };
      material.map?.dispose();
      material.dispose();
    }
  });
  group.removeFromParent();
}
