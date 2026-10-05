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
 * The most common colour among a picture's outermost pixels, as 0 to 255 per
 * channel. A generated map draws its deep sea in one exact colour, so wherever
 * sea meets the edge this is that sea, even when land runs off another side.
 */
export function edgeColor(pixels: ColorPixels): [number, number, number] {
  const { data, width, height } = pixels;
  const counts = new Map<number, number>();
  let best = 0;
  let bestCount = 0;
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if (n > bestCount) {
      best = key;
      bestCount = n;
    }
  };
  for (let x = 0; x < width; x++) {
    add(x, 0);
    if (height > 1) add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    add(0, y);
    if (width > 1) add(width - 1, y);
  }
  return [(best >> 16) & 255, (best >> 8) & 255, best & 255];
}

/** Sheets the world beyond the map reaches past each edge. */
const BEYOND_SHEETS = 1;
/** Pixels of the picture each side of a point that the edge colour is
 * averaged over, so the world beyond shows the edge's colours but not its
 * detail. */
const EDGE_BLUR = 24;
/** How far past the edge, in sheets, the edge's colours fade into
 * {@link edgeColor}. */
const BEYOND_FADE = 0.25;
/** Pixels across and down the picture of the world beyond. */
const BEYOND_PIXELS = 192;

/**
 * A picture of the world beyond the map: `BEYOND_SHEETS` sheets past every
 * edge, with the map's own place in the middle. Past each edge it shows the
 * colours along that edge, blurred and fading into {@link edgeColor} further
 * out, so land that runs off the map trails off into the sea and sea carries
 * on as sea. It is as bright as the map, so no seam shows at the edge.
 */
export function beyondPixels(pixels: ColorPixels): ColorPixels {
  const { data, width, height } = pixels;
  const far = edgeColor(pixels);
  const at = (x: number, y: number, c: number) => data[(y * width + x) * 4 + c];
  /**
   * The edge colour nearest a point given in picture pixels, averaged along
   * the edge only. Across an edge the blur stays on the edge pixel itself, so
   * a lighter shallow just inside the map does not lighten the world beyond.
   */
  const edgeNear = (
    x: number,
    y: number,
    acrossX: boolean,
    acrossY: boolean,
  ): [number, number, number] => {
    const cx = Math.min(width - 1, Math.max(0, Math.floor(x)));
    const cy = Math.min(height - 1, Math.max(0, Math.floor(y)));
    const bx = acrossX ? 0 : EDGE_BLUR;
    const by = acrossY ? 0 : EDGE_BLUR;
    const sum = [0, 0, 0];
    let n = 0;
    for (let yy = cy - by; yy <= cy + by; yy++) {
      if (yy < 0 || yy >= height) continue;
      for (let xx = cx - bx; xx <= cx + bx; xx++) {
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
      const edge = edgeNear(cu * width, cv * height, cu !== u, cv !== v);
      const o = (j * BEYOND_PIXELS + i) * 4;
      for (let c = 0; c < 3; c++) {
        out[o + c] = edge[c] + (far[c] - edge[c]) * t;
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
  // Drawn first and kept out of the depth buffer, so the sheet always covers
  // it. Any gap in depth between the two is below the buffer's precision at a
  // far zoom, and the two fought there as dark streaks.
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    depthTest: false,
    depthWrite: false,
  });
  disposables.push(geo, mat, tex);
  const plane = new THREE.Mesh(geo, mat);
  plane.name = "beyond-the-map";
  plane.renderOrder = -10;
  plane.rotation.x = -Math.PI / 2;
  // Decoration: picking goes to the sheet and what stands on it.
  plane.raycast = () => {};
  scene.add(plane);

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
