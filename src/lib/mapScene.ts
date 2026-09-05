import type * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * A built scene, handed to a view that has its own content to put on the map.
 *
 * The preview owns the terrain, the water, the sky and the lights. A view that
 * wants more than that, such as the scenario editor's units, zones and paths,
 * adds its objects to `scene`, calls `render` after each change, and is free to
 * retune `camera` and `controls` for its own way of working.
 *
 * Scene space is not engine space. The map's longer side is normalised to a
 * fixed extent, so `scale` is the scene units one engine world unit (elmo)
 * takes, and the terrain spans `planeWidth` by `planeDepth` centred on the
 * origin, lying in XZ with height along +Y.
 */
export interface MapScene3D {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  /** Draw one frame. Call after mutating anything in the scene. */
  render: () => void;
  /** Scene units per engine world unit. */
  scale: number;
  /** Terrain extent in scene units. */
  planeWidth: number;
  planeDepth: number;
}
