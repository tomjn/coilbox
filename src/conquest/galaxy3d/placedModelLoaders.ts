import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  loadUnitsyncUnitDataset,
  loadUnitsyncUnitModels,
} from "@/content/config";
import { buildModel, prepareTextureAtlas } from "@/content/unitModel";
import { TEAM_COLOUR } from "@/lib/springTexture";
import { loadFeatureObjects, resolveGameModels } from "./gameModelNames";
import type { LoadedModel, PlacedModelLoaders } from "./placedModelsLayer";

/**
 * Reading a placed model. A game model goes through the reader the unit viewer
 * and the scenario map already use, so `.s3o` and `.3do` draw the way they do
 * there. A file in the map folder is glTF, read by three.js's own loader.
 */

/** Where the view can read placed models from. */
export interface PlacedModelSources {
  /**
   * The URL of a file in the map's folder, or `undefined` when there is no
   * such file. Absent for a document that has no folder, where every `file`
   * model is reported as missing.
   */
  fileUrl?: (fileName: string) => string | undefined;
  /**
   * The installed game to read `game` models out of. Absent when the game is
   * not installed, where every `game` model is reported as missing.
   */
  game?: { enginePath: string; dataDir: string; gameArchive: string };
  /**
   * The sources are still being worked out, for example while installed games
   * are scanned. The view draws no models until this clears, so a model is
   * not reported as missing when its source was only late.
   */
  pending?: boolean;
}

/** Free everything a loaded glTF scene holds on the GPU. */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    const materials: THREE.Material[] = Array.isArray(node.material)
      ? node.material
      : [node.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

/** Read a `.gltf` or `.glb` from a URL. Rejects when it cannot be read. */
export function loadGltfModel(url: string): Promise<LoadedModel> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) =>
        resolve({
          object: gltf.scene,
          dispose: () => disposeTree(gltf.scene),
        }),
      undefined,
      () => reject(new Error("the file could not be read as glTF")),
    );
  });
}

/** The loaders the view draws placed models with, for the sources it has. */
export function placedModelLoaders(
  sources: PlacedModelSources = {},
): PlacedModelLoaders {
  const { fileUrl, game } = sources;
  return {
    async file(fileName) {
      const url = fileUrl?.(fileName);
      if (!url) throw new Error("no such file in the map folder");
      return loadGltfModel(url);
    },
    async game(names) {
      if (!game) throw new Error("the game is not installed");
      const { enginePath, dataDir, gameArchive } = game;
      // One read for the whole list, which is one mount of the game's archive,
      // and one more only for names that turn out to be units or features.
      const read = await resolveGameModels(names, {
        async read(objects) {
          const got = await loadUnitsyncUnitModels(
            enginePath,
            dataDir,
            gameArchive,
            objects,
          );
          return new Map(
            objects.map((o) => [o, got.get(o)?.root ? got.get(o) : null]),
          );
        },
        async unitObjects() {
          const dataset = await loadUnitsyncUnitDataset(
            enginePath,
            dataDir,
            gameArchive,
          );
          const out = new Map<string, string>();
          for (const unit of dataset.units) {
            const object = unit.objectName?.trim();
            if (object) out.set(unit.name.toLowerCase(), object);
          }
          return out;
        },
        featureObjects: () =>
          loadFeatureObjects({ enginePath, dataDir }, gameArchive),
      });
      const out = new Map<string, LoadedModel | null>();
      await Promise.all(
        names.map(async (name) => {
          const model = read.get(name);
          if (!model?.root) {
            out.set(name, null);
            return;
          }
          // Merged down to one mesh per material, as the scenario map draws
          // its units, because nothing here moves a piece.
          const atlas = await prepareTextureAtlas(model);
          const built = buildModel(model, TEAM_COLOUR, { merge: true, atlas });
          out.set(name, { object: built.object, dispose: built.dispose });
        }),
      );
      return out;
    },
  };
}
