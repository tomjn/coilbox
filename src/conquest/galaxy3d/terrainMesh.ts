import * as THREE from "three";
import {
  type HeightGrid,
  type TerrainSurface,
  terrainNormalPixels,
  terrainTriangles,
} from "./terrain";
import { applyTerrainShader } from "./terrainShader";

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
 * The average colour of a picture's outermost pixels, as 0 to 255 per
 * channel. On a generated land map that is the deep sea at the sheet's edge.
 */
export function edgeColor(pixels: ColorPixels): [number, number, number] {
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

/** Sheets the world beyond the map reaches past each edge. */
const BEYOND_SHEETS = 1;
/** Pixels of the picture each side of a point that the edge colour is
 * averaged over, so the world beyond shows the edge's colours but not its
 * detail. */
const EDGE_BLUR = 24;
/** How far past the edge, in sheets, the edge's colours fade into their
 * average. */
const BEYOND_FADE = 0.25;
/** How bright the world beyond is, against 1 on the map, right at the edge
 * and once faded. */
const BEYOND_NEAR = 0.85;
const BEYOND_FAR = 0.6;
/** Pixels across and down the picture of the world beyond. */
const BEYOND_PIXELS = 192;
/** How far under the sheet the world beyond lies, in world units, so the two
 * never fight over the same depth. */
const BEYOND_DROP = 0.05;

/**
 * A picture of the world beyond the map: `BEYOND_SHEETS` sheets past every
 * edge, with the map's own place in the middle. Past each edge it shows the
 * colours along that edge, blurred, fading into their average and darkening
 * further out, so land that runs off the map trails off as land and sea as
 * sea, and the edge of the map still shows.
 */
export function beyondPixels(pixels: ColorPixels): ColorPixels {
  const { data, width, height } = pixels;
  const mean = edgeColor(pixels);
  const at = (x: number, y: number, c: number) => data[(y * width + x) * 4 + c];
  /** The edge colour nearest a point given in picture pixels, averaged. */
  const edgeNear = (x: number, y: number): [number, number, number] => {
    const cx = Math.min(width - 1, Math.max(0, Math.floor(x)));
    const cy = Math.min(height - 1, Math.max(0, Math.floor(y)));
    const sum = [0, 0, 0];
    let n = 0;
    for (let yy = cy - EDGE_BLUR; yy <= cy + EDGE_BLUR; yy++) {
      if (yy < 0 || yy >= height) continue;
      for (let xx = cx - EDGE_BLUR; xx <= cx + EDGE_BLUR; xx++) {
        if (xx < 0 || xx >= width) continue;
        for (let c = 0; c < 3; c++) sum[c] += at(xx, yy, c);
        n++;
      }
    }
    return [sum[0] / n, sum[1] / n, sum[2] / n];
  };
  const span = 2 * BEYOND_SHEETS + 1;
  const out = new Uint8ClampedArray(BEYOND_PIXELS * BEYOND_PIXELS * 4);
  for (let j = 0; j < BEYOND_PIXELS; j++) {
    for (let i = 0; i < BEYOND_PIXELS; i++) {
      // In sheets, with the map from 0 to 1.
      const u = ((i + 0.5) / BEYOND_PIXELS) * span - BEYOND_SHEETS;
      const v = ((j + 0.5) / BEYOND_PIXELS) * span - BEYOND_SHEETS;
      const cu = Math.min(1, Math.max(0, u));
      const cv = Math.min(1, Math.max(0, v));
      const d = Math.sqrt((u - cu) * (u - cu) + (v - cv) * (v - cv));
      const t = Math.min(1, d / BEYOND_FADE);
      const edge = edgeNear(cu * width, cv * height);
      const shade = BEYOND_NEAR + (BEYOND_FAR - BEYOND_NEAR) * t;
      const o = (j * BEYOND_PIXELS + i) * 4;
      for (let c = 0; c < 3; c++) {
        out[o + c] = (edge[c] + (mean[c] - edge[c]) * t) * shade;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: BEYOND_PIXELS, height: BEYOND_PIXELS };
}

/**
 * Draw {@link beyondPixels} round the sheet, so a generated land map does not
 * sit in the page's black and land that runs off the map is not cut off
 * against a flat sea. Further out still, the scene's background is the
 * colour the picture fades to.
 */
function buildBeyond(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  surface: TerrainSurface,
  pixels: ColorPixels,
): void {
  const span = 2 * BEYOND_SHEETS + 1;
  const picture = beyondPixels(pixels);
  const tex = new THREE.DataTexture(
    picture.data,
    picture.width,
    picture.height,
    THREE.RGBAFormat,
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(
    surface.worldWidth * span,
    surface.worldDepth * span,
  );
  // The plane's own coordinates run bottom up and the picture top down.
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  disposables.push(geo, mat, tex);
  const plane = new THREE.Mesh(geo, mat);
  plane.name = "beyond-the-map";
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -BEYOND_DROP;
  // Decoration: picking goes to the sheet and what stands on it.
  plane.raycast = () => {};
  scene.add(plane);

  const [r, g, b] = edgeColor(pixels);
  scene.background = new THREE.Color().setRGB(
    (r * BEYOND_FAR) / 255,
    (g * BEYOND_FAR) / 255,
    (b * BEYOND_FAR) / 255,
    THREE.SRGBColorSpace,
  );
}

function isColorPixels(source: TerrainColorSource): source is ColorPixels {
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
 */
export function buildTerrainMesh(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  surface: TerrainSurface,
  color: TerrainColorSource,
  renderRef: { current: (() => void) | null },
  heights?: HeightGrid,
  detail = true,
): THREE.Mesh {
  const geo = terrainGeometry(surface);
  // Unlit: the shader lights the sheet itself, which leaves the scene's
  // lights to the few lit objects that expect them.
  const mat = new THREE.MeshBasicMaterial();
  disposables.push(geo, mat);
  let normals: THREE.DataTexture | null = null;
  if (heights && surface.maxHeight > 0) {
    normals = new THREE.DataTexture(
      terrainNormalPixels(surface, heights),
      heights.width,
      heights.height,
      THREE.RGBAFormat,
    );
    normals.flipY = false;
    normals.magFilter = THREE.LinearFilter;
    normals.minFilter = THREE.LinearMipmapLinearFilter;
    normals.generateMipmaps = true;
    normals.needsUpdate = true;
    disposables.push(normals);
  }
  applyTerrainShader(
    mat,
    { normals, detail: detail && isColorPixels(color) },
    disposables,
  );

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
      (tex) => {
        // The view was torn down while the picture was on its way.
        if (disposed) {
          tex.dispose();
          return;
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
      tex = new THREE.DataTexture(
        color.data,
        color.width,
        color.height,
        THREE.RGBAFormat,
      );
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      buildBeyond(scene, disposables, surface, color);
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
