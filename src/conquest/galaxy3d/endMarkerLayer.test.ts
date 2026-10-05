import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { GalaxyDoc, GalaxyNode } from "../model";
import { CAPITAL_SCALE, MARKER_RADIUS } from "./cityLayer";
import {
  buildEndMarkerLayer,
  END_MARKER_RADIUS,
  endMarkerReach,
} from "./endMarkerLayer";
import type { RunEnd } from "./endMarkers";
import {
  createTerrainSurface,
  GALAXY_MAX_DISTANCE,
  type HeightGrid,
} from "./terrain";

/** A 3 by 3 grid with a single peak in the middle. */
const peak: HeightGrid = {
  data: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0]),
  width: 3,
  height: 3,
};
// 100 map units across and 200 world units across: 2 world units per map unit.
const surface = createTerrainSurface(
  { width: 100, height: 100, heightScale: 10 },
  200,
  peak,
);

const node = (
  id: string,
  owner: string,
  pos: [number, number],
  extra: Partial<GalaxyNode> = {},
) => ({ id, name: id, pos, owner, difficulty: 1, ...extra }) as GalaxyNode;

/** The start is a city on the peak. The goal is a province in a corner. */
const galaxy = (models?: GalaxyDoc["models"]) =>
  ({
    nodes: [
      node("gate", "type-start", [50, 50]),
      node("mid", "type-battle", [70, 70]),
      node("keep", "type-boss", [90, 10], {
        outline: [
          [
            [80, 0],
            [100, 0],
            [100, 20],
            [80, 20],
          ],
        ],
      }),
    ],
    models,
  }) as unknown as GalaxyDoc;

const ends = new Map<string, { end?: RunEnd }>([
  ["gate", { end: "start" }],
  ["keep", { end: "goal" }],
]);
const colors: Record<string, number> = {
  "type-start": 0x4fe6d6,
  "type-boss": 0xff5468,
};
const ownerColor = (owner: string | undefined) =>
  new THREE.Color(owner && owner in colors ? colors[owner] : 0x808080);

function build(
  models?: GalaxyDoc["models"],
  which = ends,
  placed?: { failed: string[]; settled: Promise<void> },
  renderRef?: { current: (() => void) | null },
) {
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const layer = buildEndMarkerLayer(
    scene,
    disposables,
    galaxy(models),
    surface,
    which,
    ownerColor,
    placed,
    renderRef,
  );
  const marker = (name: string) =>
    scene.getObjectByName(name) as THREE.Group | undefined;
  return { scene, disposables, layer, marker };
}

const head = (group: THREE.Group | undefined) =>
  group?.children[1] as THREE.Mesh;
const model = (x: number, y: number) => ({
  model: { game: "gate" },
  pos: [x, y] as [number, number],
});

describe("endMarkerReach", () => {
  it("is the marker's own reach, which is a capital block's radius, in map units", () => {
    expect(END_MARKER_RADIUS).toBe(MARKER_RADIUS * CAPITAL_SCALE);
    expect(endMarkerReach(surface)).toBe(END_MARKER_RADIUS / 2);
  });
});

describe("buildEndMarkerLayer", () => {
  it("stands a marker on the ground at the start and at the goal", () => {
    const { scene, marker } = build();
    expect(scene.children).toHaveLength(2);
    const start = marker("end-marker:start:gate");
    const goal = marker("end-marker:goal:keep");
    // The start is on the peak: 10 map units high, 20 world units.
    expect(start?.position.toArray()).toEqual([0, 20, 0]);
    expect(goal?.position.x).toBeCloseTo(80);
    expect(goal?.position.z).toBeCloseTo(-80);
    expect(goal?.position.y).toBeCloseTo(surface.groundHeightAt(90, 10));
  });

  it("gives the two ends different shapes and their own colours", () => {
    const { marker } = build();
    const start = head(marker("end-marker:start:gate"));
    const goal = head(marker("end-marker:goal:keep"));
    expect(start.geometry).not.toBe(goal.geometry);
    expect(goal.geometry).toBeInstanceOf(THREE.OctahedronGeometry);
    const hex = (m: THREE.Mesh) =>
      (m.material as THREE.MeshBasicMaterial).color.getHex();
    expect(hex(start)).toBe(0x4fe6d6);
    expect(hex(goal)).toBe(0xff5468);
  });

  it("keeps each head above a capital's block and within its radius", () => {
    const { marker } = build();
    for (const name of ["end-marker:start:gate", "end-marker:goal:keep"]) {
      const geo = head(marker(name)).geometry;
      geo.computeBoundingBox();
      const box = geo.boundingBox as THREE.Box3;
      // The tallest a capital's block draws: see POLE_HEIGHT.
      expect(box.min.y).toBeGreaterThan(3.57);
      expect(box.max.x).toBeLessThanOrEqual(END_MARKER_RADIUS);
    }
  });

  it("never takes the pointer from the location under it", () => {
    const { scene } = build();
    const ray = new THREE.Raycaster(
      new THREE.Vector3(0, 100, 0),
      new THREE.Vector3(0, -1, 0),
    );
    expect(ray.intersectObjects(scene.children, true)).toEqual([]);
  });

  it("draws no marker under a model placed within its reach", () => {
    const reach = endMarkerReach(surface);
    const inside = build([model(50 + reach - 0.01, 50)]);
    expect(inside.marker("end-marker:start:gate")).toBeUndefined();
    expect(inside.marker("end-marker:goal:keep")).toBeDefined();
  });

  it("keeps the marker beside a model placed just outside its reach", () => {
    const reach = endMarkerReach(surface);
    const outside = build([model(50 + reach + 0.01, 50)]);
    expect(outside.marker("end-marker:start:gate")).toBeDefined();
  });

  it("builds nothing when every end has a model, or the map has no ends", () => {
    const both = build([model(50, 50), model(90, 10)]);
    expect(both.layer).toBeUndefined();
    expect(both.scene.children).toEqual([]);
    expect(both.disposables).toEqual([]);
    expect(build(undefined, new Map()).layer).toBeUndefined();
  });

  describe("when the model on an end fails to load", () => {
    const reach = endMarkerReach(surface);
    const onStart = [
      { model: { file: "gate.glb" }, pos: [50, 50] as [number, number] },
    ];

    it("draws the marker once the models have settled", async () => {
      let settle: () => void = () => {};
      const placed = {
        failed: [] as string[],
        settled: new Promise<void>((resolve) => {
          settle = resolve;
        }),
      };
      const redraw = vi.fn();
      const { marker } = build(onStart, ends, placed, { current: redraw });
      // The model might still arrive, so nothing is drawn yet.
      expect(marker("end-marker:start:gate")).toBeUndefined();

      placed.failed.push("gate.glb");
      settle();
      await placed.settled;
      await Promise.resolve();
      expect(marker("end-marker:start:gate")).toBeDefined();
      expect(redraw).toHaveBeenCalled();
    });

    it("keeps the marker away when the model loaded", async () => {
      const placed = { failed: [], settled: Promise.resolve() };
      const { marker } = build(onStart, ends, placed);
      await placed.settled;
      await Promise.resolve();
      expect(marker("end-marker:start:gate")).toBeUndefined();
    });

    it("draws the marker only when every model on the end failed", async () => {
      const both = [
        ...onStart,
        {
          model: { file: "banner.glb" },
          pos: [50 + reach / 2, 50] as [number, number],
        },
      ];
      const placed = { failed: ["gate.glb"], settled: Promise.resolve() };
      const { marker } = build(both, ends, placed);
      await placed.settled;
      await Promise.resolve();
      expect(marker("end-marker:start:gate")).toBeUndefined();
    });
  });

  it("grows past the galaxy view's furthest zoom and not before", () => {
    const { layer, marker } = build();
    const start = marker("end-marker:start:gate");
    layer?.fitToCamera(GALAXY_MAX_DISTANCE / 2);
    expect(start?.scale.x).toBe(1);
    layer?.fitToCamera(GALAXY_MAX_DISTANCE * 2);
    expect(start?.scale.x).toBe(2);
  });
});
