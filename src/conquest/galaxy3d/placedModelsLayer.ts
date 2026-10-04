import * as THREE from "three";
import { onTextureArrived } from "@/lib/textureArrival";
import type { PlacedModel } from "../placedModels";
import {
  createFailureLog,
  groupPlacedModels,
  type InstanceTransform,
  type ModelGroup,
} from "./modelPlacement";
import type { TerrainSurface } from "./terrain";

/**
 * Placed models drawn on the terrain sheet. Entries are grouped by model and
 * each group draws as one `InstancedMesh` per mesh of the model, so a forest
 * of one tree costs the tree's own draw calls however many trees there are.
 * The grouping and the transform maths live in `modelPlacement.ts`, and the
 * loaders that read a model live in `placedModelLoaders.ts`.
 */

/** A model ready to draw, and how to free it. */
export interface LoadedModel {
  object: THREE.Object3D;
  dispose(): void;
}

/** How the layer gets its models. Both are swapped for fakes under test. */
export interface PlacedModelLoaders {
  /**
   * Read models the game ships, all in one call. A name the game has no model
   * for maps to `null` or is left out.
   */
  game(names: string[]): Promise<Map<string, LoadedModel | null>>;
  /** Read one file from the map folder. Rejects when it cannot. */
  file(fileName: string): Promise<LoadedModel>;
}

/** What the layer hands back. */
export interface PlacedModelsLayer {
  /**
   * Names of the models that could not be drawn, each once. Filled in as
   * loads fail, so read it after {@link settled}.
   */
  readonly failed: string[];
  /** Resolves when every model has arrived or failed. Never rejects. */
  readonly settled: Promise<void>;
}

/**
 * The same key light and ambient level the model viewer uses. The key comes
 * from the north west of the map, the direction the terrain's relief is
 * shaded from.
 */
const KEY_LIGHT = 2.2;
const AMBIENT_LIGHT = 0.55;
const SUN: [number, number, number] = [-1, 1.5, -1];

const reasonOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** One `InstancedMesh` for each mesh of `model`, a copy at every transform. */
function instancedMeshes(
  model: LoadedModel,
  instances: InstanceTransform[],
): THREE.InstancedMesh[] {
  model.object.updateMatrixWorld(true);
  const placements = instances.map((t) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(...t.position),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        t.rotationY,
      ),
      new THREE.Vector3(t.scale, t.scale, t.scale),
    ),
  );
  const out: THREE.InstancedMesh[] = [];
  const matrix = new THREE.Matrix4();
  model.object.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const mesh = new THREE.InstancedMesh(
      node.geometry,
      node.material,
      placements.length,
    );
    placements.forEach((placement, i) => {
      // The mesh's own place inside the model first, then the placement.
      mesh.setMatrixAt(i, matrix.multiplyMatrices(placement, node.matrixWorld));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = "placed-model";
    out.push(mesh);
  });
  return out;
}

/**
 * Draw `models` on `surface`. Returns at once: the map is usable straight
 * away and each model appears when it has loaded, with `renderRef` redrawing.
 *
 * A model that is missing or cannot be read is reported once by name through
 * `warn`, however many copies the map places, and the rest still draw. A model
 * that arrives after the view was torn down is freed and not added.
 *
 * The models are lit, so when the scene has no light the layer adds a sun and
 * an ambient light with the first model. A scene that already has lights is
 * left alone.
 */
export function buildPlacedModels(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  surface: Pick<TerrainSurface, "scale" | "mapToWorldXZ" | "groundHeightAt">,
  models: readonly PlacedModel[],
  loaders: PlacedModelLoaders,
  renderRef: { current: (() => void) | null },
  warn: (message: string) => void = console.warn,
): PlacedModelsLayer {
  const log = createFailureLog(warn);
  const groups = groupPlacedModels(surface, models);
  let disposed = false;
  const held: { dispose(): void }[] = [];
  disposables.push({
    dispose: () => {
      disposed = true;
      for (const h of held) h.dispose();
    },
  });

  const lightScene = () => {
    let lit = false;
    scene.traverse((node) => {
      if (node instanceof THREE.Light) lit = true;
    });
    if (lit) return;
    const key = new THREE.DirectionalLight(0xffffff, KEY_LIGHT);
    key.position.set(...SUN);
    const ambient = new THREE.AmbientLight(0xffffff, AMBIENT_LIGHT);
    scene.add(key, ambient);
    held.push({ dispose: () => scene.remove(key, ambient) });
  };

  const arrived = (group: ModelGroup, model: LoadedModel | null) => {
    // The view was torn down while the model was on its way.
    if (disposed) {
      model?.dispose();
      return;
    }
    if (!model) {
      log.report(group.name, "the game has no model by that name");
      return;
    }
    const meshes = instancedMeshes(model, group.instances);
    if (meshes.length === 0) {
      model.dispose();
      log.report(group.name, "the model has nothing to draw");
      return;
    }
    lightScene();
    for (const mesh of meshes) scene.add(mesh);
    held.push({
      dispose: () => {
        for (const mesh of meshes) {
          mesh.removeFromParent();
          mesh.dispose();
        }
        model.dispose();
      },
    });
    renderRef.current?.();
  };

  const failedLoad = (group: ModelGroup, err: unknown) => {
    if (!disposed) log.report(group.name, reasonOf(err));
  };

  const gameGroups = groups.filter((g) => "game" in g.model);
  const fileGroups = groups.filter((g) => "file" in g.model);
  const loads: Promise<void>[] = [];

  if (gameGroups.length > 0) {
    // A game model's textures land after the model does, one frame each.
    const stop = onTextureArrived(() => renderRef.current?.());
    held.push({ dispose: stop });
    loads.push(
      loaders.game(gameGroups.map((g) => g.name)).then(
        (got) => {
          for (const g of gameGroups) arrived(g, got.get(g.name) ?? null);
        },
        (err) => {
          for (const g of gameGroups) failedLoad(g, err);
        },
      ),
    );
  }
  for (const g of fileGroups) {
    loads.push(
      loaders.file(g.name).then(
        (model) => arrived(g, model),
        (err) => failedLoad(g, err),
      ),
    );
  }

  return {
    failed: log.failed,
    settled: Promise.all(loads).then(() => undefined),
  };
}
