import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { PlacedModel } from "../placedModels";
import {
  buildPlacedModels,
  type LoadedModel,
  type PlacedModelLoaders,
} from "./placedModelsLayer";
import { createTerrainSurface } from "./terrain";

// A flat 100 by 100 map over 200 world units: 2 world units per map unit.
const surface = createTerrainSurface({ width: 100, height: 100 }, 200);

/** A model of `meshes` meshes, the first raised 1 unit inside the model. */
function fakeModel(meshes = 1): LoadedModel & { disposed: boolean } {
  const object = new THREE.Group();
  for (let i = 0; i < meshes; i++) {
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    if (i === 0) mesh.position.set(0, 1, 0);
    object.add(mesh);
  }
  const model = {
    object,
    disposed: false,
    dispose: () => {
      model.disposed = true;
    },
  };
  return model;
}

/** Loaders that answer from a table. A name not in it has no model. */
function loaders(
  table: Record<string, LoadedModel> = {},
): PlacedModelLoaders & { gameCalls: string[][] } {
  const gameCalls: string[][] = [];
  return {
    gameCalls,
    async game(names) {
      gameCalls.push(names);
      return new Map(names.map((n) => [n, table[n] ?? null]));
    },
    async file(name) {
      const model = table[name];
      if (!model) throw new Error("no such file in the map folder");
      return model;
    },
  };
}

const instanced = (scene: THREE.Scene): THREE.InstancedMesh[] =>
  scene.children.filter(
    (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh,
  );

function build(
  models: PlacedModel[],
  from: PlacedModelLoaders,
  warn = vi.fn(),
) {
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const render = vi.fn();
  const layer = buildPlacedModels(
    scene,
    disposables,
    surface,
    models,
    from,
    { current: render },
    warn,
  );
  const teardown = () => {
    for (const d of disposables) d.dispose();
  };
  return { scene, layer, render, warn, teardown };
}

describe("buildPlacedModels", () => {
  it("draws many copies of a model as one instanced mesh per mesh", async () => {
    const tree = fakeModel(2);
    const forest: PlacedModel[] = Array.from({ length: 300 }, (_, i) => ({
      model: { game: "tree" },
      pos: [i % 100, 50],
    }));
    const from = loaders({ tree });
    const { scene, layer, render } = build(forest, from);

    // Nothing is drawn until the model arrives, and the map is not held up.
    expect(instanced(scene)).toHaveLength(0);
    await layer.settled;

    const meshes = instanced(scene);
    expect(meshes).toHaveLength(2);
    expect(meshes.every((m) => m.count === 300)).toBe(true);
    expect(from.gameCalls).toEqual([["tree"]]);
    expect(render).toHaveBeenCalled();
    expect(layer.failed).toEqual([]);
  });

  it("places an instance at its position, turn and scale", async () => {
    const { scene, layer } = build(
      [{ model: { file: "gate.glb" }, pos: [75, 50], rotation: 90, scale: 3 }],
      loaders({ "gate.glb": fakeModel() }),
    );
    await layer.settled;

    const matrix = new THREE.Matrix4();
    instanced(scene)[0].getMatrixAt(0, matrix);
    const position = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, turn, scale);
    // The mesh sits 1 unit up inside the model, which is 6 world units at a
    // scale of 3 on a surface of 2 world units per map unit.
    expect(position.x).toBeCloseTo(50);
    expect(position.y).toBeCloseTo(6);
    expect(position.z).toBeCloseTo(0);
    expect(scale.x).toBeCloseTo(6);
    // 90 degrees turns the model's +Z, the bottom of the map, to +X.
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(turn);
    expect(facing.x).toBeCloseTo(1);
    expect(facing.z).toBeCloseTo(0);
  });

  it("reports a missing model once however many copies there are", async () => {
    const missing: PlacedModel[] = Array.from({ length: 50 }, (_, i) => ({
      model: { game: "nosuchtree" },
      pos: [i, i],
    }));
    const { scene, layer, warn } = build(
      [
        ...missing,
        { model: { file: "lost.glb" }, pos: [1, 1] },
        { model: { file: "lost.glb" }, pos: [2, 2] },
        { model: { game: "tree" }, pos: [3, 3] },
      ],
      loaders({ tree: fakeModel() }),
    );
    await layer.settled;

    expect(warn).toHaveBeenCalledTimes(2);
    expect(layer.failed).toEqual(["nosuchtree", "lost.glb"]);
    // The model that did load still draws.
    expect(instanced(scene)).toHaveLength(1);
  });

  it("reports every game model once when the read itself fails", async () => {
    const from = loaders();
    from.game = async () => {
      throw new Error("the game is not installed");
    };
    const { layer, warn } = build(
      [
        { model: { game: "tree" }, pos: [1, 1] },
        { model: { game: "tree" }, pos: [2, 2] },
        { model: { game: "rock" }, pos: [3, 3] },
      ],
      from,
    );
    await layer.settled;

    expect(layer.failed).toEqual(["tree", "rock"]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain("the game is not installed");
  });

  it("reports a model with nothing to draw and frees it", async () => {
    const empty = fakeModel(0);
    const { scene, layer } = build(
      [{ model: { file: "empty.glb" }, pos: [1, 1] }],
      loaders({ "empty.glb": empty }),
    );
    await layer.settled;

    expect(layer.failed).toEqual(["empty.glb"]);
    expect(empty.disposed).toBe(true);
    expect(instanced(scene)).toHaveLength(0);
  });

  it("frees a model that arrives after the view was torn down", async () => {
    const tree = fakeModel();
    const gate = fakeModel();
    const { scene, layer, teardown, warn, render } = build(
      [
        { model: { game: "tree" }, pos: [1, 1] },
        { model: { file: "gate.glb" }, pos: [2, 2] },
        { model: { file: "lost.glb" }, pos: [3, 3] },
      ],
      loaders({ tree, "gate.glb": gate }),
    );
    teardown();
    await layer.settled;

    expect(tree.disposed).toBe(true);
    expect(gate.disposed).toBe(true);
    expect(scene.children).toHaveLength(0);
    expect(render).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("removes and frees what it drew on teardown", async () => {
    const tree = fakeModel();
    const { scene, layer, teardown } = build(
      [{ model: { game: "tree" }, pos: [1, 1] }],
      loaders({ tree }),
    );
    await layer.settled;
    expect(scene.children.length).toBeGreaterThan(0);

    teardown();
    expect(scene.children).toHaveLength(0);
    expect(tree.disposed).toBe(true);
  });

  it("lights an unlit scene and leaves a lit one alone", async () => {
    const lights = (scene: THREE.Scene) =>
      scene.children.filter((c) => c instanceof THREE.Light).length;
    const models: PlacedModel[] = [{ model: { game: "tree" }, pos: [1, 1] }];

    const unlit = build(models, loaders({ tree: fakeModel() }));
    await unlit.layer.settled;
    expect(lights(unlit.scene)).toBe(2);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight());
    const layer = buildPlacedModels(
      scene,
      [],
      surface,
      models,
      loaders({ tree: fakeModel() }),
      { current: null },
      vi.fn(),
    );
    await layer.settled;
    expect(lights(scene)).toBe(1);
  });
});
