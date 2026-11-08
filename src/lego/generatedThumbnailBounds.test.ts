/**
 * A generated unit's thumbnail frames the unit's own parts (#5128).
 *
 * The builder hands `captureThumbnail` the scene's root, with every piece in it
 * parented as `syncScene` leaves them. The generate screen draws the same unit
 * from `unitObject`, which places each part from `worldMatrix`. The two have to
 * give the same bounds, or the saved thumbnail is a speck in an empty square.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { bodyPlanById } from "./bodyPlans";
import { unitObject } from "./candidatePictures";
import { generateCandidates } from "./candidates";
import { type LegoPackManifest, type LoadedPack, mergePacks } from "./pack";
import { type SceneGraph, syncScene } from "./pages/components/sceneState";
import { starterModules } from "./starterModules";
import { thumbnailCamera } from "./thumbnail";

// The part material loads its atlas through the DOM, which bounds do not need.
vi.mock("./geometry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./geometry")>()),
  partMaterial: () => new THREE.MeshStandardMaterial(),
}));

/** The bundled parts with their geometry, which the generator measures. */
function bundledPack(): LoadedPack {
  const dir = fileURLToPath(
    new URL("../../src-tauri/legoparts/", import.meta.url),
  );
  const manifest = JSON.parse(
    readFileSync(`${dir}pack.json`, "utf8"),
  ) as LegoPackManifest;
  const blob = new Uint8Array(gunzipSync(readFileSync(`${dir}parts.bin.gz`)));
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const vertexOffset = view.getUint32(16, true);
  const vertexBytes = view.getUint32(20, true);
  const indexOffset = view.getUint32(24, true);
  const indexBytes = view.getUint32(28, true);
  const vertices = new Float32Array(
    blob.slice(vertexOffset, vertexOffset + vertexBytes).buffer,
  );
  const indices = new Uint16Array(
    blob.slice(indexOffset, indexOffset + indexBytes).buffer,
  );
  const merged = mergePacks([{ manifest, vertices, indices }]);
  return {
    ...merged,
    vertices,
    indices,
    library: {
      packs: [manifest],
      atlases: [{ tex1: "atlas.png", packId: "lego", folder: null }],
      dir: "",
      problems: [],
    },
  };
}

const pack = bundledPack();
const modules = starterModules(pack);
let made = 0;
const options = () => ({
  id: `unit${++made}`,
  rootPieceId: `root${made}`,
  now: "2026-11-08T00:00:00.000Z",
  pack,
  modules,
});

/** What the builder builds for a unit: the root `syncScene` fills. */
function builderRoot(unit: Parameters<typeof syncScene>[3]): THREE.Group {
  const graph = {
    root: new THREE.Group(),
    groups: new Map<string, THREE.Group>(),
    imported: null,
    lifted: new Map(),
    gizmo: { object: undefined, detach() {} },
  };
  syncScene(graph as unknown as SceneGraph, pack, null, unit);
  graph.root.updateMatrixWorld(true);
  return graph.root;
}

describe("a generated unit's thumbnail bounds", () => {
  const cases = [
    { plan: "wheeled", seeds: 40 },
    { plan: "tracked", seeds: 40 },
    { plan: "biped", seeds: 40 },
    { plan: "quadruped", seeds: 40 },
  ];

  it.each(cases)("match the parts of a $plan unit", ({ plan, seeds }) => {
    const bodyPlan = bodyPlanById(plan);
    if (!bodyPlan) throw new Error(`no ${plan} plan`);
    const batch = generateCandidates(
      { plan: bodyPlan, job: "assault", size: "medium" },
      seeds,
      6,
      options,
    );
    expect(batch.candidates.length).toBeGreaterThan(0);

    for (const { unit, seed } of batch.candidates) {
      const parts = unitObject(unit, pack, new THREE.MeshStandardMaterial());
      const root = builderRoot(unit);
      const want = new THREE.Box3().setFromObject(parts);
      const got = new THREE.Box3().setFromObject(root);

      for (const [axis, a, b] of [
        ["x", want.min.x, got.min.x],
        ["y", want.min.y, got.min.y],
        ["z", want.min.z, got.min.z],
        ["x", want.max.x, got.max.x],
        ["y", want.max.y, got.max.y],
        ["z", want.max.z, got.max.z],
      ] as const) {
        expect(b, `${plan} seed ${seed} ${axis}`).toBeCloseTo(a, 3);
      }

      // The camera is placed from those bounds, so it is where the generate
      // screen's picture puts it.
      const camera = thumbnailCamera(root);
      const expected = thumbnailCamera(parts);
      expect(camera.position.distanceTo(expected.position)).toBeLessThan(1e-3);
    }
  });
});
