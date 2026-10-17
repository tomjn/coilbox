/**
 * What surrounds the unit in the builder: what is behind it, and what it stands
 * on.
 *
 * These are two different surfaces, so they are two separate choices. A sky is
 * only ever seen past the edge of the ground, and a ground is only ever seen
 * under the unit, so pairing them into one list of presets would offer four
 * combinations as four unrelated names and hide the fact that either one can be
 * left alone.
 *
 * Both are view settings. They are held by the viewport for as long as it is
 * open, exactly as the grid and reference toggles are, and reach neither the
 * document nor an export.
 *
 * Everything here is built rather than loaded: a gradient and a mottle cost a
 * canvas each and no asset. `MapPreview3D` builds its detail and cloud textures
 * the same way.
 *
 * The rule both options are designed against: nothing here may make the unit
 * harder to see. So the lights are untouched (a part looks the same in the
 * picker and the editor, see `geometry.ts`), there is no fog (fog would tint the
 * unit itself once the camera pulled back), the sky is a muted dusk rather than
 * a bright noon, and the ground is a low-contrast mottle rather than a texture
 * you could mistake for part of the model.
 */

import * as THREE from "three";

import { GROUND_ELMOS } from "./buildPlate";
import type { UnitBounds } from "./s3oBuild";
import { ELMOS_PER_FOOTPRINT, footprintSteps } from "./unitDef";

export type BackdropId = "studio" | "sky";
export type GroundId = "grid" | "terrain" | "water" | "slope" | "uneven";

/** A gradient stop, measured from the top of the sky down. 0.5 is the horizon. */
interface SkyStop {
  at: number;
  colour: string;
}

export interface Backdrop {
  id: BackdropId;
  label: string;
  /** What it is for, one line, shown under the choice. */
  hint: string;
  /**
   * The sky, top to bottom. Empty leaves the canvas transparent, which is the
   * plain dark panel the builder has always had.
   */
  stops: SkyStop[];
}

/**
 * Two backdrops, because they answer two different questions: "can I see what I
 * am building" and "what will this look like in a game".
 *
 * There is deliberately no pale backdrop. The viewport's own chrome (the button
 * outlines, the hint text, the plate labels) is drawn for a dark app, and a pale
 * sky puts light grey text on a light background.
 *
 * The sky's colours are muted and mid-dark on purpose. A bright noon sky behind
 * a grey brick is worse than the plain backdrop, which is the thing this option
 * is most likely to get wrong.
 */
export const BACKDROPS: Backdrop[] = [
  {
    id: "studio",
    label: "Plain",
    hint: "A dark panel. The most contrast for the model.",
    stops: [],
  },
  {
    id: "sky",
    label: "Sky",
    hint: "A dusk gradient, so the unit is seen outdoors.",
    stops: [
      { at: 0, colour: "#16202e" },
      { at: 0.4, colour: "#2f4a63" },
      { at: 0.5, colour: "#63788c" },
      { at: 0.52, colour: "#2c3737" },
      { at: 1, colour: "#171c1e" },
    ],
  },
];

export interface GroundSurface {
  id: GroundId;
  label: string;
  hint: string;
}

/**
 * Five grounds. The grid alone is see-through, which is what makes a piece
 * hanging under the ground plane obvious. Terrain is opaque, which is what the
 * engine will actually put under the unit. Water is for a ship or a hovercraft:
 * the engine's sea level is also y = 0, and a translucent surface shows how
 * much of a hull sits under it.
 *
 * Slope and uneven are for previewing movement rather than for building: a
 * walker's feet reach different heights on them, and a unit that is not
 * upright turns to follow them. Both are at height 0 under the unit's origin,
 * so the unit stands where it always does.
 */
export const GROUND_SURFACES: GroundSurface[] = [
  {
    id: "grid",
    label: "Grid only",
    hint: "Markings over the backdrop, nothing solid.",
  },
  {
    id: "terrain",
    label: "Terrain",
    hint: "A flat, muted surface under the markings.",
  },
  {
    id: "water",
    label: "Water",
    hint: "A see-through sea at y = 0, for how a hull sits in it.",
  },
  {
    id: "slope",
    label: "Slope",
    hint: "A hill rising ahead of the unit.",
  },
  {
    id: "uneven",
    label: "Uneven",
    hint: "Rows of bumps, steepest under the unit.",
  },
];

/**
 * A ground with height in it. Mirrors `Shape` in
 * `crates/coilbox-unitpose/src/ground.rs`, which answers a script asking where
 * the ground is, so the two have to agree to the number.
 */
export type GroundShape =
  | {
      /** A plane through the origin rising towards +z, ahead of the unit. */
      kind: "slope";
      degrees: number;
    }
  | {
      /** Bumps and hollows `width` elmos apart, steepest at the origin, where
       *  they rise towards +x at `degrees`. */
      kind: "uneven";
      degrees: number;
      width: number;
    };

/** What the ground picker holds. A view setting, like the rest of this. */
export interface GroundChoice {
  id: GroundId;
  /** How steep a slope or uneven ground is, in degrees from level. */
  degrees: number;
  /** How far apart the bumps are, in elmos, or null to follow the unit's
   *  footprint as it changes. */
  width: number | null;
  /** Whether the unit stays upright rather than turning to the ground. */
  upright: boolean;
}

/**
 * The angle a slope opens at: 22.5 degrees, the steepest ground a hover can
 * climb with the engine's default `maxSlope` of 15. The engine multiplies a
 * movement class's `maxSlope` by 1.5 before comparing it to the ground
 * (`DegreesToMaxSlope` in `rts/Sim/MoveTypes/MoveDefHandler.cpp`), and 15 is
 * the hover default there.
 */
export const DEFAULT_GROUND_DEGREES = 15 * 1.5;

/**
 * Off, so a unit turns to follow a slope. That is the engine's own default
 * for `upright` (`UnitDef.cpp:419`), and the one a unit with a movement class
 * keeps. A unit with no movement class is made upright unless it flies, but
 * these grounds are for a unit that moves.
 */
export const DEFAULT_GROUND: GroundChoice = {
  id: "grid",
  degrees: DEFAULT_GROUND_DEGREES,
  width: null,
  upright: false,
};

/** Whether `degrees` is a slope there is a ground for: level, up to but not
 *  including a wall. */
export function validGroundDegrees(degrees: number): boolean {
  return Number.isFinite(degrees) && degrees >= 0 && degrees < 90;
}

/**
 * The narrowest bumps there can be, in elmos: two of the engine's heightmap
 * squares (`SQUARE_SIZE`, 8 elmos, in `rts/Sim/Misc/GlobalConstants.h`),
 * which is one rise and one fall. A map has
 * no height between its squares' corners, so it cannot hold a narrower one.
 */
export const MIN_BUMP_WIDTH = 2 * 8;

/** The width uneven ground opens at: the unit's own footprint, the larger way
 *  round, so the bumps are sized to the unit standing on them. */
export function footprintWidth(bounds: UnitBounds): number {
  return (
    Math.max(footprintSteps(bounds.sizeX), footprintSteps(bounds.sizeZ)) *
    ELMOS_PER_FOOTPRINT
  );
}

/** The shape the choice draws, or null for a flat one. */
export function groundShape(
  choice: Pick<GroundChoice, "id" | "degrees" | "width">,
  footprint: number,
): GroundShape | null {
  if (choice.id === "slope") return { kind: "slope", degrees: choice.degrees };
  if (choice.id === "uneven")
    return {
      kind: "uneven",
      degrees: choice.degrees,
      width: choice.width ?? footprint,
    };
  return null;
}

/** The ground's height at `x`, `z`, in elmos. */
export function groundHeight(shape: GroundShape, x: number, z: number): number {
  const tan = Math.tan((shape.degrees * Math.PI) / 180);
  if (shape.kind === "slope") return z * tan;
  const k = (2 * Math.PI) / shape.width;
  // `sin(kx) cos(kz)` is steepest at the origin, with a gradient of `k` along
  // x, so this amplitude makes that `tan(degrees)`.
  return (tan / k) * Math.sin(k * x) * Math.cos(k * z);
}

/** Which way is up off the ground at `x`, `z`, as a unit vector. */
export function groundNormal(
  shape: GroundShape,
  x: number,
  z: number,
): [number, number, number] {
  const tan = Math.tan((shape.degrees * Math.PI) / 180);
  let dx = 0;
  let dz = tan;
  if (shape.kind === "uneven") {
    const k = (2 * Math.PI) / shape.width;
    dx = tan * Math.cos(k * x) * Math.cos(k * z);
    dz = -tan * Math.sin(k * x) * Math.sin(k * z);
  }
  const length = Math.hypot(dx, 1, dz);
  return [-dx / length, 1 / length, -dz / length];
}

/**
 * Which way is up for the unit standing at the origin, or null for straight
 * up.
 *
 * The engine turns a ground unit that is not upright to the ground's normal
 * under it (`GroundMoveType.cpp` calls `UpdateDirVectors(!owner->upright &&
 * owner->IsOnGround(), ...)`, and `CSolidObject::GetWantedUpDir` reads
 * `CGround::GetSmoothNormal`). `upDirSmoothing` only slows the turn on the way
 * there, and a unit standing still has already arrived, so it has no say.
 */
export function unitUp(
  shape: GroundShape | null,
  upright: boolean,
): [number, number, number] | null {
  if (!shape || upright) return null;
  return groundNormal(shape, 0, 0);
}

export function backdropById(id: string): Backdrop {
  return BACKDROPS.find((backdrop) => backdrop.id === id) ?? BACKDROPS[0];
}

export function groundById(id: string): GroundSurface {
  return (
    GROUND_SURFACES.find((ground) => ground.id === id) ?? GROUND_SURFACES[0]
  );
}

/**
 * How far the terrain reaches, in elmos: twice the grid, so the whole grid sits
 * on solid ground and the outer half is nothing but the fade.
 */
export const TERRAIN_ELMOS = GROUND_ELMOS * 2;

/**
 * How many times larger than its default the terrain is drawn so that it is
 * solid out to `reachElmos` from the origin, which is where a unit driving
 * away from it still needs ground under it. 1 until the reach passes the
 * default solid radius, so a unit that goes nowhere gets the ground it always
 * had. The texture and its fade scale with it, which keeps the fade the same
 * shape and the texture a single shot.
 */
export function terrainScale(reachElmos: number): number {
  return Math.max(1, reachElmos / (GROUND_ELMOS / 2));
}

/**
 * How opaque the terrain is that far from the origin.
 *
 * `scale` is `terrainScale`'s answer for a terrain drawn larger than its default.
 *
 * The terrain is a finite plane, so it has an edge, and an edge in view reads as
 * a slab floating in space. Rather than fog (which would tint the unit as the
 * camera pulled back) the surface fades out on its own: solid under the whole
 * grid, then a smooth falloff to nothing by the rim. Against the sky that fade
 * reads as distance haze. Against the plain backdrop it reads as the ground
 * going dark.
 */
export function terrainAlpha(elmosFromCentre: number, scale = 1): number {
  const solid = (GROUND_ELMOS / 2) * scale;
  const rim = (TERRAIN_ELMOS / 2) * scale;
  if (elmosFromCentre <= solid) return 1;
  if (elmosFromCentre >= rim) return 0;
  const t = (elmosFromCentre - solid) / (rim - solid);
  // Smoothstep, so the fade has no band in it where the falloff starts.
  return 1 - t * t * (3 - 2 * t);
}

/** A hair under the grid, so the markings draw on top and a piece sitting on
 *  y = 0 still touches the ground it is standing on. */
const TERRAIN_Y = -0.02;

/** The terrain's texture, in pixels. It does not tile: the fade is one shot
 *  across the whole plane, so the mottle has to be one shot too. */
const TERRAIN_PIXELS = 1024;

/** The ground's own colours: a desaturated olive, varied just enough not to be
 *  a flat fill. Dark, so a grey part stands out against it. */
const TERRAIN_BASE = "#3f4437";
const TERRAIN_BLOBS = ["#4a4d3c", "#373d33"];
/** How many blobs, and how big each can be as a fraction of the texture. */
const TERRAIN_BLOB_COUNT = 90;
const TERRAIN_BLOB_MIN = 0.03;
const TERRAIN_BLOB_RANGE = 0.09;
/** Per-pixel grain, either side of what the blobs left. Small: the point is to
 *  stop the surface looking like a flat fill, not to draw a texture. */
const TERRAIN_GRAIN = 10;

/**
 * The sky, as an equirectangular texture.
 *
 * Equirectangular rather than a flat background quad, so the horizon is a real
 * horizon: it stays where the world is as the camera orbits, rather than being
 * painted across the middle of the screen whichever way you look. `null` for a
 * backdrop with no sky, and for the unit tests, which have no canvas to draw on.
 */
export function skyTexture(backdrop: Backdrop): THREE.Texture | null {
  if (backdrop.stops.length === 0) return null;
  const canvas =
    typeof document === "undefined" ? null : document.createElement("canvas");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return null;

  // One column is all a vertical gradient needs, and the sampler stretches it
  // round the horizon from there.
  canvas.width = 1;
  canvas.height = 512;
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  for (const stop of backdrop.stops)
    gradient.addColorStop(stop.at, stop.colour);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The solid ground, in its own mesh: never selectable, never exported, and
 * drawn before everything else so the grid and the plates sit on top of it.
 */
export function buildTerrain(reachElmos = 0): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(TERRAIN_ELMOS, TERRAIN_ELMOS);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, TERRAIN_Y, 0);

  const material = new THREE.MeshBasicMaterial({
    map: terrainTexture(),
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  mesh.raycast = () => {};
  reachTerrain(mesh, reachElmos);
  return mesh;
}

/** Stretch a flat terrain or sea so it is solid out to `reachElmos`. It is a
 *  plane at one height, so scaling it sideways is all it takes. */
export function reachTerrain(mesh: THREE.Mesh, reachElmos: number): void {
  const scale = terrainScale(reachElmos);
  mesh.scale.set(scale, 1, scale);
}

/**
 * The ground's surface: a mottle that fades out towards the rim.
 *
 * Unlit and flat rather than a lit, displaced surface. Units stand on y = 0 and
 * the engine reserves flat ground for them, so a builder's ground that had
 * height in it would be ground the unit could not actually sit on.
 */
function terrainTexture(): THREE.CanvasTexture | null {
  const canvas =
    typeof document === "undefined" ? null : document.createElement("canvas");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return null;

  const size = TERRAIN_PIXELS;
  canvas.width = size;
  canvas.height = size;
  context.fillStyle = TERRAIN_BASE;
  context.fillRect(0, 0, size, size);

  // Soft overlapping blobs, alternating lighter and darker, so the surface has
  // some shape to it without any one mark being readable as an object.
  for (let i = 0; i < TERRAIN_BLOB_COUNT; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius =
      size * (TERRAIN_BLOB_MIN + Math.random() * TERRAIN_BLOB_RANGE);
    const colour = TERRAIN_BLOBS[i % TERRAIN_BLOBS.length];
    const blob = context.createRadialGradient(x, y, 0, x, y, radius);
    blob.addColorStop(0, `${colour}66`);
    blob.addColorStop(1, `${colour}00`);
    context.fillStyle = blob;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  // The grain and the rim fade go on together, since both are per pixel.
  const image = context.getImageData(0, 0, size, size);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const grain = Math.round((Math.random() - 0.5) * TERRAIN_GRAIN);
      image.data[i] += grain;
      image.data[i + 1] += grain;
      image.data[i + 2] += grain;
      const elmos =
        (Math.hypot(x - half, y - half) / half) * (TERRAIN_ELMOS / 2);
      image.data[i + 3] = Math.round(terrainAlpha(elmos) * 255);
    }
  }
  context.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The ground is read at a grazing angle, where a texture short of samples
  // turns to a smear. The same reason the plate labels ask for it.
  texture.anisotropy = 8;
  return texture;
}

/**
 * Rows of the shaped ground's mesh per bump. A drawing resolution only: the
 * answer a script gets comes from `groundHeight`, not from the mesh.
 */
const SEGMENTS_PER_BUMP = 16;

/**
 * Most rows the shaped ground's mesh gets along a side. Ground drawn out to a
 * long drive wants 16 rows per bump over a huge area, which is millions of
 * points and over a second to build (#4160), so a large ground is drawn with
 * fewer rows per bump instead. 512 rows is 263169 points.
 */
const MAX_SEGMENTS = 512;

/**
 * How uneven ground is shaded, as the shader's uniforms: `k` is the bumps'
 * wavenumber, `2π / width`, and `tan` is how steep they are at their steepest.
 * Both are 0 for a slope, which the shader then leaves as it was.
 */
export interface GroundShading {
  k: number;
  tan: number;
}

export function groundShading(shape: GroundShape): GroundShading {
  if (shape.kind !== "uneven") return { k: 0, tan: 0 };
  return {
    k: (2 * Math.PI) / shape.width,
    tan: Math.tan((shape.degrees * Math.PI) / 180),
  };
}

/**
 * Contour lines from level ground up to a crest, and the same down to a dip.
 * 2 puts one ring half way up each bump and one along the level ground
 * between, which are straight lines crossing between the bumps.
 */
const CONTOUR_STEPS = 2;

/** How much darker a dip is drawn, and how much lighter a crest, as a
 *  multiple of the ground's colour. */
const GROUND_DIP = 0.55;
const GROUND_CREST = 1.45;
/** How much of the ground's colour a contour line takes away. */
const CONTOUR_DARKEN = 0.45;

/**
 * Uneven ground's height, slope and contours, worked out per pixel from
 * `groundHeight`'s formula rather than read off the mesh. The mesh is coarse
 * far from the origin (#4160), down to a couple of rows a bump, and
 * its normals smear a bump into a wave there. The formula does not.
 *
 * Three things show the shape. The light falls on the formula's own normal,
 * so each bump's sunward side is bright and its far side in shade. The colour
 * runs from dark in a dip to light on a crest. And a dark line marks each
 * contour. Where a bump is smaller than a pixel all three fade back to the
 * mesh's own shading, which would otherwise shimmer.
 */
function shadeUnevenGround(
  material: THREE.MeshLambertMaterial,
  shading: GroundShading,
): void {
  const uniforms = {
    groundK: { value: shading.k },
    groundTan: { value: shading.tan },
  };
  material.userData.groundShading = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vGroundXZ;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvGroundXZ = position.xz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float groundK;
uniform float groundTan;
varying vec2 vGroundXZ;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
if (groundTan > 0.0) {
  vec2 p = vGroundXZ * groundK;
  // Radians of bump per pixel. A bump is 2 pi, so past 1 there are too few
  // pixels to draw one and the detail fades out.
  float detail = 1.0 - smoothstep(0.5, 1.0, length(fwidth(p)));
  float h = sin(p.x) * cos(p.y);
  vec3 up = normalize(vec3(
    -groundTan * cos(p.x) * cos(p.y),
    1.0,
    groundTan * sin(p.x) * sin(p.y)
  ));
  normal = normalize(mix(normal, normalize(mat3(viewMatrix) * up), detail));
  float lift = mix(1.0, mix(${GROUND_DIP.toFixed(2)}, ${GROUND_CREST.toFixed(2)}, h * 0.5 + 0.5), detail);
  float level = h * ${CONTOUR_STEPS.toFixed(1)};
  float width = fwidth(level);
  float onLine = 1.0 - smoothstep(0.5, 1.5, abs(fract(level + 0.5) - 0.5) / max(width, 1e-4));
  // A line wider than a third of the gap to the next one is mush, so fade it.
  onLine *= 1.0 - smoothstep(0.15, 0.35, width);
  // The top step is the crest or the dip itself, a point rather than a ring.
  onLine *= 1.0 - step(${CONTOUR_STEPS.toFixed(1)} - 0.5, abs(level));
  diffuseColor.rgb *= lift * (1.0 - ${CONTOUR_DARKEN.toFixed(2)} * onLine * detail);
}`,
      );
  };
}

/**
 * A ground with height in it, in its own mesh: the terrain's mottle and fade
 * over a displaced plane.
 *
 * Lit, unlike the flat terrain, because an unlit surface with height in it
 * shows no height: the mottle is all there is to see. And it writes depth, so
 * a foot that reaches into a hill disappears into it, which is the point of
 * standing a unit on one. Uneven ground is shaded by its height too, see
 * `shadeUnevenGround`.
 */
export function buildShapedTerrain(
  shape: GroundShape,
  reachElmos = 0,
): THREE.Mesh {
  const material = new THREE.MeshLambertMaterial({
    map: terrainTexture(),
    transparent: true,
  });
  shadeUnevenGround(material, groundShading(shape));
  const mesh = new THREE.Mesh(shapedGeometry(shape, reachElmos), material);
  mesh.renderOrder = -1;
  mesh.raycast = () => {};
  return mesh;
}

/** Swap the shaped ground's surface for another shape's, keeping its
 *  texture, which is the expensive part. */
export function reshapeTerrain(
  mesh: THREE.Mesh,
  shape: GroundShape,
  reachElmos = 0,
): void {
  mesh.geometry.dispose();
  mesh.geometry = shapedGeometry(shape, reachElmos);
  const shading = groundShading(shape);
  const uniforms = (mesh.material as THREE.MeshLambertMaterial).userData
    .groundShading;
  uniforms.groundK.value = shading.k;
  uniforms.groundTan.value = shading.tan;
}

/** The surface is built at its drawn size rather than scaled, because its
 *  heights are read off `groundHeight` at the place each point really is. */
function shapedGeometry(
  shape: GroundShape,
  reachElmos: number,
): THREE.PlaneGeometry {
  const size = TERRAIN_ELMOS * terrainScale(reachElmos);
  // A slope is flat, so the plane's own two triangles are already exact.
  const segments =
    shape.kind === "slope"
      ? 1
      : Math.min(
          MAX_SEGMENTS,
          Math.ceil((size / shape.width) * SEGMENTS_PER_BUMP),
        );
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const height = groundHeight(shape, position.getX(i), position.getZ(i));
    position.setY(i, height + TERRAIN_Y);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Frees what `buildTerrain`, `buildWater` or `buildShapedTerrain`
 *  allocated. They are built from the same parts. */
export function disposeTerrain(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material as
    | THREE.MeshBasicMaterial
    | THREE.MeshLambertMaterial;
  material.map?.dispose();
  material.dispose();
}

/** The sea's colour, and how opaque it is where it is solid. See-through
 *  enough that a hull under the surface still reads as the same part. */
const WATER_COLOUR = "#1f5670";
const WATER_OPACITY = 0.6;
/** The sea's texture, in pixels. It is one flat colour with a fade, so it
 *  needs far fewer than the terrain's mottle. */
const WATER_PIXELS = 256;

/**
 * The sea, in its own mesh: the same plane as the terrain, fading out the same
 * way, but a flat translucent blue.
 *
 * Transparent, so three draws it after every solid piece. That is what lets
 * the part of a hull below the surface show through tinted, while the part
 * above it hides the water behind it.
 */
export function buildWater(reachElmos = 0): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(TERRAIN_ELMOS, TERRAIN_ELMOS);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, TERRAIN_Y, 0);

  const material = new THREE.MeshBasicMaterial({
    map: waterTexture(),
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  mesh.raycast = () => {};
  reachTerrain(mesh, reachElmos);
  return mesh;
}

function waterTexture(): THREE.CanvasTexture | null {
  const canvas =
    typeof document === "undefined" ? null : document.createElement("canvas");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return null;

  const size = WATER_PIXELS;
  canvas.width = size;
  canvas.height = size;
  context.fillStyle = WATER_COLOUR;
  context.fillRect(0, 0, size, size);

  const image = context.getImageData(0, 0, size, size);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const elmos =
        (Math.hypot(x - half, y - half) / half) * (TERRAIN_ELMOS / 2);
      image.data[(y * size + x) * 4 + 3] = Math.round(
        terrainAlpha(elmos) * WATER_OPACITY * 255,
      );
    }
  }
  context.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
