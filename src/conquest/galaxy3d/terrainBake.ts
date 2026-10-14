import * as THREE from "three";

/**
 * A land map's ground detail drawn once into pictures when the map opens, in
 * place of being worked out for every pixel of every frame (issue #3992). The
 * detail never changes while a map is open, and the sun is fixed, so the lit
 * colour goes into the picture. Only the glint on water moves with the
 * camera, and the sheet's own shader keeps that (`terrainShader.ts`).
 *
 * The sheet is drawn flat into the picture by its picture coordinates, so the
 * shader's footprint is one texel and it picks the detail for that size with
 * no change. The picture's mipmaps then do what the shader's distance fades
 * did.
 *
 * The draw is split into tiles, one a frame, so a slow GPU never spends one
 * long frame on it. The sheet shows the map picture lit by its relief until
 * the last tile is done.
 */

/**
 * The longest side of the sheet's picture in texels. A map of 24 locations is
 * 115 units across, so a texel is 0.028 units, 1.3 times a screen pixel at
 * the closest zoom on a 1080p screen. 64 MiB, 85 MiB with mipmaps.
 */
export const SHEET_BAKE_SIZE = 4096;

/**
 * The longest side of the picture for the land past the sheet's edge. That
 * land is greyed and hazed and mostly seen from far off. On a map of 24
 * locations it is 217 units across, so a texel is 0.11 units, about a device
 * pixel at the furthest zoom. 16 MiB, 21 MiB with mipmaps.
 */
export const MARGIN_BAKE_SIZE = 2048;

/** Texels across one tile, the most drawn in one frame. */
export const BAKE_TILE = 1024;

/** One picture, what is drawn into it, and where it lies on the map picture. */
export interface BakePass {
  target: THREE.WebGLRenderTarget;
  /** The map picture's coordinates it covers: x, y, width and height. */
  rect: THREE.Vector4;
  geometries: THREE.BufferGeometry[];
}

/**
 * A picture for `geometries`, at most `size` texels along its longest side,
 * shaped as they are on the ground so a texel is square.
 */
export function bakePass(
  geometries: THREE.BufferGeometry[],
  size: number,
): BakePass {
  const lo = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const hi = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const box = new THREE.Box3();
  for (const geo of geometries) {
    const uv = geo.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      lo[0] = Math.min(lo[0], u);
      lo[1] = Math.min(lo[1], v);
      hi[0] = Math.max(hi[0], u);
      hi[1] = Math.max(hi[1], v);
    }
    geo.computeBoundingBox();
    if (geo.boundingBox) box.union(geo.boundingBox);
  }
  const across = box.max.x - box.min.x;
  const down = box.max.z - box.min.z;
  const [width, height] =
    across >= down
      ? [size, Math.max(1, Math.round((size * down) / across))]
      : [Math.max(1, Math.round((size * across) / down)), size];
  const target = new THREE.WebGLRenderTarget(width, height, {
    colorSpace: THREE.SRGBColorSpace,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  return {
    target,
    rect: new THREE.Vector4(lo[0], lo[1], hi[0] - lo[0], hi[1] - lo[1]),
    geometries,
  };
}

export interface TerrainBake {
  /** The material that draws the detail. Disposed once the bake is done. */
  readonly material: THREE.Material;
  /**
   * Draw the next tile. Answers whether any are left, so the caller asks for
   * another frame. Does nothing once the bake is done.
   */
  step(renderer: THREE.WebGLRenderer): boolean;
  dispose(): void;
}

/**
 * Bake `passes` with `material`, whose `rect` uniform says which picture it is
 * drawing into. `ready` turns to 1 when the last tile is drawn. `inputs` are
 * the textures only the bake reads, freed with the material when it is done.
 */
export function createTerrainBake(
  material: THREE.Material,
  rect: { value: THREE.Vector4 },
  passes: BakePass[],
  ready: { value: number },
  inputs: THREE.Texture[],
): TerrainBake {
  const camera = new THREE.OrthographicCamera();
  const scenes = passes.map((pass) => {
    const scene = new THREE.Scene();
    for (const geo of pass.geometries) {
      const mesh = new THREE.Mesh(geo, material);
      // Placed in the picture by the vertex shader, not the camera.
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    return scene;
  });
  const tiles: { pass: number; x: number; y: number; w: number; h: number }[] =
    [];
  let next = 0;
  let done = false;
  let started = false;
  const finish = () => {
    done = true;
    material.dispose();
    for (const tex of inputs) tex.dispose();
  };

  const start = (renderer: THREE.WebGLRenderer) => {
    const most = renderer.capabilities.maxTextureSize;
    const anisotropy = renderer.capabilities.getMaxAnisotropy();
    passes.forEach((pass, p) => {
      const { target } = pass;
      const scale = Math.min(1, most / Math.max(target.width, target.height));
      if (scale < 1) {
        target.setSize(
          Math.max(1, Math.floor(target.width * scale)),
          Math.max(1, Math.floor(target.height * scale)),
        );
      }
      target.texture.anisotropy = anisotropy;
      target.scissorTest = true;
      // Storage for every mipmap level is made now, while mipmaps are on.
      // They are then made once, after the last tile, not after every one.
      renderer.initRenderTarget(target);
      target.texture.generateMipmaps = false;
      for (let y = 0; y < target.height; y += BAKE_TILE) {
        for (let x = 0; x < target.width; x += BAKE_TILE) {
          tiles.push({
            pass: p,
            x,
            y,
            w: Math.min(BAKE_TILE, target.width - x),
            h: Math.min(BAKE_TILE, target.height - y),
          });
        }
      }
    });
  };

  return {
    material,
    step(renderer) {
      if (done) return false;
      if (!started) {
        started = true;
        start(renderer);
      }
      const tile = tiles[next++];
      const pass = passes[tile.pass];
      const target = pass.target;
      target.texture.generateMipmaps =
        next === tiles.length || tiles[next].pass !== tile.pass;
      rect.value.copy(pass.rect);
      target.scissor.set(tile.x, tile.y, tile.w, tile.h);
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scenes[tile.pass], camera);
      renderer.setRenderTarget(previous);
      if (next === tiles.length) {
        ready.value = 1;
        finish();
      }
      return !done;
    },
    dispose() {
      for (const pass of passes) pass.target.dispose();
      if (!done) finish();
    },
  };
}
