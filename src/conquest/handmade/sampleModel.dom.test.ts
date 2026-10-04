// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { expect, it } from "vitest";

// Tests run from the repo root. `import.meta.url` is not a file URL here.
const CAIRN = resolve("docs/examples/handmade-map/cairn.gltf");

it("the sample's model is glTF the view's loader reads", async () => {
  const gltf = await new GLTFLoader().parseAsync(
    readFileSync(CAIRN, "utf8"),
    "",
  );
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((node) => {
    if (node instanceof THREE.Mesh) meshes.push(node);
  });
  expect(meshes).toHaveLength(1);
  const { geometry } = meshes[0];
  // Four sides and a base of two triangles, over five corners.
  expect(geometry.index?.count).toBe(18);
  expect(geometry.attributes.position.count).toBe(5);
  // It stands on its origin, 40 map units across and 60 tall.
  const box = new THREE.Box3().setFromObject(gltf.scene);
  expect(box.min.toArray()).toEqual([-20, 0, -20]);
  expect(box.max.toArray()).toEqual([20, 60, 20]);
});
