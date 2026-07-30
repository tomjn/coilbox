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

export type BackdropId = "studio" | "sky";
export type GroundId = "grid" | "terrain";

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
 * Two grounds. The grid alone is see-through, which is what makes a piece
 * hanging under the ground plane obvious. Terrain is opaque, which is what the
 * engine will actually put under the unit.
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
];

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
 * How opaque the terrain is that far from the origin.
 *
 * The terrain is a finite plane, so it has an edge, and an edge in view reads as
 * a slab floating in space. Rather than fog (which would tint the unit as the
 * camera pulled back) the surface fades out on its own: solid under the whole
 * grid, then a smooth falloff to nothing by the rim. Against the sky that fade
 * reads as distance haze. Against the plain backdrop it reads as the ground
 * going dark.
 */
export function terrainAlpha(elmosFromCentre: number): number {
  const solid = GROUND_ELMOS / 2;
  const rim = TERRAIN_ELMOS / 2;
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
export function buildTerrain(): THREE.Mesh {
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
  return mesh;
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

/** Frees what `buildTerrain` allocated. */
export function disposeTerrain(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material as THREE.MeshBasicMaterial;
  material.map?.dispose();
  material.dispose();
}
