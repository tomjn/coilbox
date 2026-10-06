import * as THREE from "three";
import type { PlanetId } from "../planets";
import type { GroundShading } from "./groundShader";
import {
  apronHeights,
  apronPicture,
  apronPixels,
  commonEdgeColor,
  drawnPixels,
  flatGrid,
} from "./handmadeEdge";
import {
  createMarginSurface,
  type HeightGrid,
  type MarginSurface,
  marginGeometry,
  type TerrainSurface,
  terrainNormalPixels,
  terrainTriangles,
} from "./terrain";
import { applyTerrainShader, type TerrainFrame } from "./terrainShader";

/**
 * The terrain sheet as a three.js mesh: the map picture laid over a
 * {@link TerrainSurface}, raised where the surface is, lit and given surface
 * detail in its shader (`terrainShader.ts`). The maths lives in `terrain.ts`.
 */

/** Raw RGBA bytes, top row first, as a canvas or `ImageData` gives them. */
export interface ColorPixels {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/**
 * The map picture: a URL the webview can load, a canvas or bitmap, or raw
 * RGBA pixels. A generator that already holds pixels passes them as they are.
 */
export type TerrainColorSource =
  | string
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageBitmap
  | ColorPixels;

/** Shown until a picture given as a URL has loaded, and if it fails to. */
const PLACEHOLDER_COLOR = 0x2a3242;

/** Sheet geometry for a surface: positions and picture coordinates. */
export function terrainGeometry(surface: TerrainSurface): THREE.BufferGeometry {
  const { segmentsX, segmentsY, vertexHeights } = surface;
  const cols = segmentsX + 1;
  const count = cols * (segmentsY + 1);
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  for (let j = 0; j <= segmentsY; j++) {
    for (let i = 0; i <= segmentsX; i++) {
      const v = j * cols + i;
      const u = i / segmentsX;
      const w = j / segmentsY;
      const [x, z] = surface.mapToWorldXZ(
        u * surface.width,
        w * surface.height,
      );
      positions.set([x, vertexHeights[v], z], v * 3);
      // The top of the picture is v = 0. Every texture below turns flipY off
      // to match, so a URL, a canvas and raw pixels all land the same way up.
      uvs.set([u, w], v * 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(
    new THREE.BufferAttribute(terrainTriangles(segmentsX, segmentsY), 1),
  );
  return geo;
}

/**
 * The average colour of a picture's outermost ring of pixels, as 0 to 255 per
 * channel. For a map drawn with land past its edge this is where the land
 * beyond has hazed to, so it is the haze's colour and the scene's background.
 */
export function outerRingColor(pixels: ColorPixels): [number, number, number] {
  const { data, width, height } = pixels;
  const sum = [0, 0, 0];
  let count = 0;
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    sum[0] += data[i];
    sum[1] += data[i + 1];
    sum[2] += data[i + 2];
    count++;
  };
  for (let x = 0; x < width; x++) {
    add(x, 0);
    if (height > 1) add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    add(0, y);
    if (width > 1) add(width - 1, y);
  }
  return [sum[0] / count, sum[1] / count, sum[2] / count];
}

/**
 * A generated map's picture and heights with land drawn past its edge, as
 * `extendTerrain` builds them: the map's own in the middle, `margin` pixels
 * round it.
 */
export interface TerrainExtension {
  image: ColorPixels;
  heights: HeightGrid;
  margin: number;
  /**
   * `heights` before they were rounded to a byte, for the light alone. The
   * ground's shape stays `heights`.
   */
  relief?: HeightGrid;
  /** The generator's weights at this picture's size. */
  biomes?: BiomePixels;
}

/**
 * A generator's biome weights as RGBA bytes: `a` holds slots 0 to 3 and `b`
 * slots 4 to 7. Row by row from the top left, the same size as the picture
 * they go with.
 */
export interface BiomePixels {
  a: Uint8Array;
  b: Uint8Array;
  width: number;
  height: number;
  planet: PlanetId;
}

/**
 * Draw the land past the sheet's edge with the sheet's own material, so the
 * two are one surface with one shading. The ring meets the sheet at the
 * sheet's edge vertices and never lies under or over it, so nothing is
 * coplanar with the sea and the two never fight for depth.
 */
function buildMargin(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  surface: TerrainSurface,
  margin: MarginSurface,
  mat: THREE.Material,
): void {
  const data = marginGeometry(surface, margin);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(data.uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(data.index, 1));
  disposables.push(geo);
  const ring = new THREE.Mesh(geo, mat);
  ring.name = "terrain-margin";
  // Decoration: picking goes to the map and what stands on it.
  ring.raycast = () => {};
  scene.add(ring);
}

export function isColorPixels(
  source: TerrainColorSource,
): source is ColorPixels {
  return (
    typeof source === "object" &&
    "data" in source &&
    ArrayBuffer.isView(source.data)
  );
}

/**
 * Build the terrain sheet into `scene` and return its mesh. The mesh writes
 * depth, so anything behind a hill is hidden by it, and it stays raycastable
 * so later layers can pick against the ground.
 *
 * A picture given as a URL loads in the background: the sheet shows a plain
 * placeholder colour until it arrives, then `renderRef` redraws. A picture
 * that fails to load is reported once and the placeholder stays.
 *
 * `heights` lights the sheet's slopes per pixel. A generated map, whose
 * picture comes as pixels, also gets procedural texture by biome unless
 * `detail` is off, as it is in performance mode. A hand-made map's painted
 * picture is left as its author drew it.
 *
 * `extension` draws a generated map's land on past its edge as one surface
 * with the sheet, greyed a little past the edge and hazing into the scene's
 * background. A map without one, such as a hand-made map, gets a short apron
 * the same way instead. See handmadeEdge.ts.
 *
 * `ground` paints roads into the sheet.
 */
export function buildTerrainMesh(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  surface: TerrainSurface,
  color: TerrainColorSource,
  renderRef: { current: (() => void) | null },
  heights?: HeightGrid,
  detail = true,
  extension?: TerrainExtension,
  /** Roads painted into the ground. See `groundShader.ts`. */
  ground?: GroundShading,
  /** The map's own weights, which go with `color` when it is pixels. */
  biomes?: BiomePixels,
): THREE.Mesh {
  const geo = terrainGeometry(surface);
  // Unlit: the shader lights the sheet itself, which leaves the scene's
  // lights to the few lit objects that expect them.
  const mat = new THREE.MeshBasicMaterial();
  disposables.push(geo, mat);

  // With land past the edge, the picture and heights are the wider ones and
  // the sheet's picture coordinates move into their middle.
  const ext =
    extension && heights && surface.maxHeight > 0 ? extension : undefined;
  // A map with no land past its edge gets a short apron in the same shape.
  const apronFrom =
    heights && surface.maxHeight > 0
      ? heights
      : flatGrid(surface.worldWidth, surface.worldDepth);
  const apron = ext
    ? undefined
    : {
        heights: apronHeights(apronFrom, apronPixels(apronFrom)),
        margin: apronPixels(apronFrom),
      };
  const wide = ext ?? apron;
  const margin = wide
    ? createMarginSurface(surface, wide.heights, wide.margin)
    : undefined;
  if (wide && margin) {
    const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
    const across = wide.heights.width;
    const down = wide.heights.height;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(
        i,
        (uv.getX(i) * margin.mapPixels + wide.margin) / across,
        (uv.getY(i) * (down - 2 * wide.margin) + wide.margin) / down,
      );
    }
  }
  // The apron's picture is the map's own, widened by its edge pixels.
  const widened = (picture: ColorPixels): ColorPixels =>
    apron
      ? apronPicture(picture, apronFrom.width, apronFrom.height, apron.margin)
      : picture;

  let normals: THREE.DataTexture | null = null;
  const grid = wide && surface.maxHeight > 0 ? wide.heights : heights;
  if (grid && surface.maxHeight > 0) {
    const span = margin
      ? {
          width: surface.worldWidth + 2 * margin.reachX,
          depth: surface.worldDepth + 2 * margin.reachZ,
        }
      : undefined;
    normals = new THREE.DataTexture(
      terrainNormalPixels(surface, grid, span, ext?.relief),
      grid.width,
      grid.height,
      THREE.RGBAFormat,
    );
    normals.flipY = false;
    normals.magFilter = THREE.LinearFilter;
    normals.minFilter = THREE.LinearMipmapLinearFilter;
    normals.generateMipmaps = true;
    normals.needsUpdate = true;
    disposables.push(normals);
  }

  // The weights for the picture the mesh draws: the extension's with the
  // extension, otherwise the map's, widened as its picture is. Data, so they
  // take no colour space.
  let biomeTextures: {
    a: THREE.Texture;
    b: THREE.Texture;
    planet: PlanetId;
  } | null = null;
  const weights = ext ? ext.biomes : biomes;
  if (detail && weights && isColorPixels(color)) {
    const texture = (data: Uint8Array): THREE.Texture => {
      const picture = { data, width: weights.width, height: weights.height };
      const drawn = ext ? picture : widened(picture);
      const tex = new THREE.DataTexture(
        drawn.data,
        drawn.width,
        drawn.height,
        THREE.RGBAFormat,
      );
      tex.flipY = false;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      disposables.push(tex);
      return tex;
    };
    biomeTextures = {
      a: texture(weights.a),
      b: texture(weights.b),
      planet: weights.planet,
    };
  }

  let frame: TerrainFrame | undefined;
  // The haze's colour, and the background's. An apron round a picture still
  // loading takes the placeholder's until the picture arrives.
  const far = new THREE.Color(PLACEHOLDER_COLOR);
  const hazeTo = (picture: ColorPixels) => {
    const [r, g, b] = (ext ? outerRingColor : commonEdgeColor)(picture);
    far.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  };
  if (ext) hazeTo(ext.image);
  else if (isColorPixels(color)) hazeTo(color);
  if (margin) {
    scene.background = far;
    frame = {
      halfX: surface.worldWidth / 2,
      halfZ: surface.worldDepth / 2,
      width: surface.worldWidth,
      depth: surface.worldDepth,
      // Hazed out by the time the margin ends, so its end never shows.
      haze: Math.min(
        margin.reachX / surface.worldWidth,
        margin.reachZ / surface.worldDepth,
      ),
      far,
      greyBeyond: !apron,
    };
  }
  applyTerrainShader(
    mat,
    {
      normals,
      biomes: biomeTextures,
      detail: detail && isColorPixels(color),
      frame,
      ground,
    },
    disposables,
  );
  if (margin) buildMargin(scene, disposables, surface, margin, mat);

  const pixelTexture = (picture: ColorPixels): THREE.Texture => {
    const tex = new THREE.DataTexture(
      picture.data,
      picture.width,
      picture.height,
      THREE.RGBAFormat,
    );
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    return tex;
  };

  const applyTexture = (tex: THREE.Texture) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.needsUpdate = true;
    mat.map = tex;
    mat.color.set(0xffffff);
    mat.needsUpdate = true;
  };

  if (typeof color === "string") {
    mat.color.set(PLACEHOLDER_COLOR);
    let disposed = false;
    let loaded: THREE.Texture | undefined;
    disposables.push({
      dispose: () => {
        disposed = true;
        loaded?.dispose();
      },
    });
    new THREE.TextureLoader().load(
      color,
      (arrived) => {
        // The view was torn down while the picture was on its way.
        if (disposed) {
          arrived.dispose();
          return;
        }
        let tex: THREE.Texture = arrived;
        if (apron) {
          // Widen the picture by its edge for the apron, and haze to it.
          const picture = drawnPixels(arrived.image);
          hazeTo(picture);
          arrived.dispose();
          tex = pixelTexture(widened(picture));
        }
        loaded = tex;
        applyTexture(tex);
        renderRef.current?.();
      },
      undefined,
      () => {
        if (!disposed) console.warn("terrain image failed to load", color);
      },
    );
  } else {
    let tex: THREE.Texture;
    if (isColorPixels(color)) {
      tex = pixelTexture(ext ? ext.image : widened(color));
    } else if (apron) {
      const picture = drawnPixels(color);
      hazeTo(picture);
      tex = pixelTexture(widened(picture));
    } else {
      tex = new THREE.CanvasTexture(color);
    }
    applyTexture(tex);
    disposables.push(tex);
  }

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "terrain";
  scene.add(mesh);
  return mesh;
}
