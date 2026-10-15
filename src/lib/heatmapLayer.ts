/**
 * A density field drawn on the 3D map, as a texture lying on the terrain
 * (issue #1151).
 *
 * Every other layer on the map is objects: a ring, a post, a sheet cut to a
 * zone. A heatmap is a field, so it is one texture over the whole ground.
 *
 * It does not project anything itself. The terrain is a flat plane whose
 * material lifts each vertex by a height texture, and this layer draws a
 * second mesh over the same plane, lifted by the same texture with the same
 * scale and bias. The two surfaces are the same surface, so the field stays
 * registered to the ground however the camera moves, and a polygon offset
 * decides which of the two is in front.
 *
 * Where a field's cell lands is decided by the terrain's own UVs: `u` runs
 * west to east and `v` runs south to north. `paintHeatField` is asked for its
 * rows south first to match. `heatmapLayer.test.ts` checks the corners with
 * numbers, because a mirrored picture looks as plausible as a right one.
 *
 * The field and its colours are `heatField.ts` and `heatRamp.ts`.
 */

import * as THREE from "three";

import type { HeatField } from "./heatField";
import { type HeatPaintOptions, paintHeatField } from "./heatRamp";
import type { MapScene3D } from "./mapScene";

/** What the layer is drawn under, so it can be found and removed as one thing. */
export const HEATMAP_ROOT_NAME = "map-heatmap";

const VERTEX = /* glsl */ `
uniform sampler2D relief;
uniform float reliefScale;
uniform float reliefBias;
uniform bool hasRelief;
varying vec2 vHeatUv;
void main() {
  vHeatUv = uv;
  vec3 lifted = position;
  if ( hasRelief ) lifted.y += texture2D( relief, uv ).x * reliefScale + reliefBias;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( lifted, 1.0 );
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D heat;
varying vec2 vHeatUv;
void main() {
  gl_FragColor = texture2D( heat, vHeatUv );
  #include <colorspace_fragment>
}`;

export interface HeatmapLayer {
  root: THREE.Group;
  /**
   * Draw this field, replacing whatever was drawn before. Null, or a field
   * with nothing in it, draws nothing and holds no texture.
   */
  draw: (field: HeatField | null, options?: HeatPaintOptions) => void;
  dispose: () => void;
}

/**
 * The plane a flat scene's field is drawn on, when there is no terrain to
 * share. Built the way the preview builds its own: flat in XZ, north at
 * negative z.
 */
function flatPlane(handle: MapScene3D): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(
    handle.planeWidth,
    handle.planeDepth,
  );
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export function createHeatmapLayer(handle: MapScene3D): HeatmapLayer {
  const root = new THREE.Group();
  root.name = HEATMAP_ROOT_NAME;
  handle.scene.add(root);

  const terrain = handle.terrain;
  const reliefMap = terrain?.material.displacementMap ?? null;
  // The terrain's geometry belongs to the preview. Only a plane made here is
  // this layer's to free.
  const ownGeometry = terrain ? null : flatPlane(handle);
  const geometry = terrain ? terrain.geometry : ownGeometry;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      heat: { value: null },
      relief: { value: reliefMap },
      reliefScale: { value: terrain?.material.displacementScale ?? 0 },
      reliefBias: { value: terrain?.material.displacementBias ?? 0 },
      hasRelief: { value: reliefMap !== null },
    },
    transparent: true,
    depthWrite: false,
    // Drawn on the terrain's own surface, so without this the two would fight
    // over every pixel.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry as THREE.BufferGeometry, material);
  mesh.renderOrder = 2;
  mesh.visible = false;
  root.add(mesh);

  let texture: THREE.DataTexture | null = null;
  const dropTexture = () => {
    texture?.dispose();
    texture = null;
    material.uniforms.heat.value = null;
  };

  return {
    root,
    draw: (field, options) => {
      dropTexture();
      if (!field || field.peak <= 0) {
        mesh.visible = false;
        handle.render();
        return;
      }
      const rgba = paintHeatField(field, { ...options, southFirst: true });
      texture = new THREE.DataTexture(
        rgba,
        field.width,
        field.height,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      );
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      material.uniforms.heat.value = texture;
      mesh.visible = true;
      handle.render();
    },
    dispose: () => {
      dropTexture();
      material.dispose();
      ownGeometry?.dispose();
      root.clear();
      root.removeFromParent();
    },
  };
}
