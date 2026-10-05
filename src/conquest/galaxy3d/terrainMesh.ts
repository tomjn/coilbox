import * as THREE from "three";
import {
  type TerrainSurface,
  terrainShades,
  terrainTriangles,
} from "./terrain";

/**
 * The terrain sheet as a three.js mesh: the map picture laid over a
 * {@link TerrainSurface}, raised where the surface is, with shaded relief
 * baked into its vertex colours. The maths lives in `terrain.ts`.
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

/** Sheet geometry for a surface: positions, picture coordinates and shading. */
export function terrainGeometry(surface: TerrainSurface): THREE.BufferGeometry {
  const { segmentsX, segmentsY, vertexHeights } = surface;
  const cols = segmentsX + 1;
  const count = cols * (segmentsY + 1);
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const colors = new Float32Array(count * 3);
  const shades = terrainShades(surface);
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
      colors.fill(shades[v], v * 3, v * 3 + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
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

/**
 * Fill everything the scene does not draw with the colour of the sheet's
 * edge, so a generated land map sits in its own sea rather than in the page's
 * black, at any zoom or tilt. Level ground is shaded exactly 1, so the sea
 * around the sheet matches the sea at its edge.
 */
function fillWithSea(scene: THREE.Scene, pixels: ColorPixels): void {
  const [r, g, b] = edgeColor(pixels);
  scene.background = new THREE.Color().setRGB(
    r / 255,
    g / 255,
    b / 255,
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
 */
export function buildTerrainMesh(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  surface: TerrainSurface,
  color: TerrainColorSource,
  renderRef: { current: (() => void) | null },
): THREE.Mesh {
  const geo = terrainGeometry(surface);
  // Unlit: the relief shading is already in the vertex colours, which leaves
  // the scene's lights to the few lit objects that expect them.
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  disposables.push(geo, mat);

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
      fillWithSea(scene, color);
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
