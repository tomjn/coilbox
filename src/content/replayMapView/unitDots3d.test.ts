import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import type { MapScene3D } from "@/lib/mapScene";
import { fieldFromGrid } from "@/placement/terrain";
import fixture from "../fixtures/replay-track-window.json";
import { DEATH_BLASTS } from "./blasts3d";
import { createReplayClock } from "./clock";
import { SHOTS_NAME, WRECKS_NAME } from "./effects3d";
import type { UnitIcons } from "./icons";
import type { TeamStyle } from "./paint";
import { collectScene, createMapScene } from "./scene";
import { testTrack } from "./testTrack";
import {
  createUnitDotsLayer,
  type DotGround,
  dotColours,
  ICONS_NAME,
  writeDotColours,
  writeDotPositions,
} from "./unitDots3d";

/** A 2 by 2 grid that rises from 0 at the west to half the range at the east
 *  (50 elmos), over a 1,000 by 1,000 elmo map whose heights run 0 to 100. */
const ground: DotGround = {
  field: fieldFromGrid({
    width: 2,
    height: 2,
    words: Uint16Array.of(0, 32768, 0, 32768),
  }),
  worldWidth: 1000,
  worldHeight: 1000,
  minHeight: 0,
  maxHeight: 100,
};

describe("writeDotPositions", () => {
  it("puts an elmo position in scene space, on the ground, scaled", () => {
    const scene = createMapScene();
    scene.units = 3;
    scene.unitX.set([0, 500, 1000]);
    scene.unitZ.set([0, 500, 1000]);
    const out = new Float32Array(9);
    expect(writeDotPositions(scene, ground, 0.01, out)).toBe(3);
    // The north-west corner is half a map back and left of the centre, at the
    // field's lowest height.
    expect([out[0], out[1], out[2]]).toEqual([-5, 0, -5].map(Math.fround));
    // The middle is the origin, half way up the slope: 25 elmos.
    expect(out[3]).toBeCloseTo(0);
    expect(out[4]).toBeCloseTo(0.25);
    expect(out[5]).toBeCloseTo(0);
    // The south-east corner, at the east edge's height.
    expect(out[6]).toBeCloseTo(5);
    expect(out[7]).toBeCloseTo(0.5);
    expect(out[8]).toBeCloseTo(5);
  });
});

describe("dot colours", () => {
  const teams = new Map<number, TeamStyle>([
    [0, { fill: "#ff0000", edge: "#000" }],
    [1, { fill: "#0000ff", edge: "#000", alpha: 0.5 }],
  ]);

  it("colours each unit by its team, darker for a faint one, grey for an unknown", () => {
    const scene = createMapScene();
    scene.units = 3;
    scene.unitTeam.set([0, 1, 7]);
    const out = new Float32Array(9);
    writeDotColours(scene, dotColours(teams), out);
    const red = new THREE.Color("#ff0000");
    const blue = new THREE.Color("#0000ff");
    const grey = new THREE.Color("#888888");
    expect([out[0], out[1], out[2]]).toEqual(
      [red.r, red.g, red.b].map(Math.fround),
    );
    expect(out[5]).toBeCloseTo(blue.b * 0.5);
    expect(out[6]).toBeCloseTo(grey.r);
  });
});

/** A scene with the parts the layer touches. */
function fakeView(): MapScene3D & { drawn: ReturnType<typeof vi.fn> } {
  const drawn = vi.fn();
  return {
    scene: new THREE.Scene(),
    render: drawn,
    scale: 0.01,
    drawn,
  } as unknown as MapScene3D & { drawn: ReturnType<typeof vi.fn> };
}

function manualFrames() {
  const waiting = new Map<number, () => void>();
  let next = 1;
  return {
    env: {
      requestFrame: (cb: () => void) => {
        waiting.set(next, cb);
        return next++;
      },
      cancelFrame: (id: number) => void waiting.delete(id),
    },
    waiting,
    run() {
      const due = [...waiting.values()];
      waiting.clear();
      for (const cb of due) cb();
    },
  };
}

const TEAMS = new Map<number, TeamStyle>([
  [0, { fill: "#ff0000", edge: "#000" }],
  [1, { fill: "#00ff00", edge: "#000" }],
]);

/** The layer's points in a view. */
const pointsOf = (view: MapScene3D) =>
  view.scene.getObjectByName("replay-unit-dots") as THREE.Points;

describe("the unit dots layer", () => {
  async function setup() {
    const track = testTrack();
    await track.seek(0);
    const clock = createReplayClock(0);
    const view = fakeView();
    const frames = manualFrames();
    const layer = createUnitDotsLayer({
      view,
      track: track.handle,
      clock,
      teams: TEAMS,
      ground,
      env: frames.env,
    });
    return { track, clock, view, frames, layer };
  }

  it("draws the shared handle's units at the clock's frame, and again when the clock moves", async () => {
    const { track, clock, view, frames } = await setup();
    const points = pointsOf(view);
    frames.run();
    // The fixture has one unit at frame 0 and two at frame 30.
    expect(points.geometry.drawRange.count).toBe(track.handle.unitCountAt(0));
    expect(points.geometry.drawRange.count).toBe(1);
    expect(view.drawn).toHaveBeenCalled();

    clock.set(30);
    await track.seek(30);
    frames.run();
    expect(points.geometry.drawRange.count).toBe(2);
    // Each dot is where the track has the unit, over this map's extent.
    const at = fixture.transform.find((t) => t.serial === 1 && t.frame === 30);
    if (!at) throw new Error("the fixture has no unit 1 at frame 30");
    const positions = points.geometry.attributes.position.array;
    const found = [0, 1].some((i) => {
      const x = (at.x - 500) * 0.01;
      const z = (at.z - 500) * 0.01;
      return (
        Math.abs(positions[i * 3] - x) < 1e-3 &&
        Math.abs(positions[i * 3 + 2] - z) < 1e-3
      );
    });
    expect(found).toBe(true);
  });

  it("asks for one animation frame however many changes came, and none when nothing changes", async () => {
    const { clock, frames } = await setup();
    frames.run();
    expect(frames.waiting.size).toBe(0);
    clock.set(10);
    clock.set(20);
    clock.set(30);
    expect(frames.waiting.size).toBe(1);
    frames.run();
    expect(frames.waiting.size).toBe(0);
  });

  it("keeps the last picture while the frame's window is on its way", async () => {
    const { clock, view, frames, track } = await setup();
    frames.run();
    const drawn = view.drawn.mock.calls.length;
    // Window 2 has not arrived.
    clock.set(150);
    frames.run();
    expect(track.waiting().length).toBeGreaterThan(0);
    expect(view.drawn.mock.calls.length).toBe(drawn);
    expect(pointsOf(view).geometry.drawRange.count).toBe(1);
  });

  it("draws a unit with a game icon as that icon, at the icon's size, and goes back to dots without icons", async () => {
    const { view, frames, layer } = await setup();
    const picture = {} as CanvasImageSource;
    const icons: UnitIcons = {
      edge: () => 0,
      sprite: () => null,
      type: () => ({ name: "tank", picture, edge: 12 }),
    };
    layer.setIcons(icons);
    frames.run();
    const iconPoints = view.scene.getObjectByName(
      `${ICONS_NAME}tank`,
    ) as THREE.Points;
    expect(iconPoints.geometry.drawRange.count).toBe(1);
    expect(pointsOf(view).geometry.drawRange.count).toBe(0);
    const material = iconPoints.material as THREE.PointsMaterial;
    expect(material.size).toBe(12);
    expect(material.map?.image).toBe(picture);

    layer.setIcons(null);
    frames.run();
    expect(view.scene.getObjectByName(`${ICONS_NAME}tank`)).toBeUndefined();
    expect(pointsOf(view).geometry.drawRange.count).toBe(1);
  });

  it("marks where a unit died with a circle part way through its fade, and only while explosions are on", async () => {
    const { track, clock, view, frames, layer } = await setup();
    const blasts = () =>
      view.scene.getObjectByName(DEATH_BLASTS.name) as THREE.Points;
    // Unit 1's last frame is 89, so at 95 it died 6 frames ago.
    clock.set(95);
    await track.seek(95);
    frames.run();
    expect(blasts().geometry.drawRange.count).toBe(0);

    layer.setExplosions(true);
    frames.run();
    expect(blasts().geometry.drawRange.count).toBe(1);
    // 0.4 seconds at 30 frames a second is a span of 12 frames.
    expect(blasts().geometry.attributes.progress.array[0]).toBeCloseTo(6 / 13);

    clock.set(110);
    frames.run();
    expect(blasts().geometry.drawRange.count).toBe(0);
  });

  it("draws the flat map's projectiles and wrecks on the ground", async () => {
    const { track, clock, view, frames } = await setup();
    const count = (name: string) =>
      (view.scene.getObjectByName(name) as THREE.Points).geometry.drawRange
        .count;
    frames.run();
    expect(count(SHOTS_NAME)).toBe(0);
    expect(count(WRECKS_NAME)).toBe(0);

    // At frame 50 projectiles are in the air, and the wreck that appeared
    // at frame 40 is on the ground. Its scenery feature from frame 0 is not.
    clock.set(50);
    await track.seek(50);
    frames.run();
    // Two vertices a projectile, as many as the flat map's scene holds.
    const flat = createMapScene();
    collectScene(track.handle, 50, flat);
    expect(flat.projectiles).toBeGreaterThan(0);
    expect(count(SHOTS_NAME)).toBe(flat.projectiles * 2);
    expect(count(WRECKS_NAME)).toBe(1);
    const wreck = (view.scene.getObjectByName(WRECKS_NAME) as THREE.Points)
      .geometry.attributes.position.array;
    expect(wreck[0]).toBeCloseTo((1200.5 - 500) * 0.01);
    expect(wreck[2]).toBeCloseTo((300.25 - 500) * 0.01);
  });

  it("gives each unit an opacity, solid once built", async () => {
    const { view, frames } = await setup();
    frames.run();
    const colour = pointsOf(view).geometry.attributes.color;
    expect(colour.itemSize).toBe(4);
    expect(colour.array[3]).toBeGreaterThan(0);
    expect(colour.array[3]).toBeLessThanOrEqual(1);
  });

  it("removes its points and frees the GPU objects when disposed", async () => {
    const { clock, view, frames, layer } = await setup();
    frames.run();
    const points = pointsOf(view);
    const geometry = vi.spyOn(points.geometry, "dispose");
    const material = vi.spyOn(points.material as THREE.Material, "dispose");
    clock.set(10);
    expect(frames.waiting.size).toBe(1);

    layer.dispose();
    expect(geometry).toHaveBeenCalled();
    expect(material).toHaveBeenCalled();
    expect(pointsOf(view)).toBeUndefined();
    // Its pending frame is taken back, and the clock no longer reaches it.
    expect(frames.waiting.size).toBe(0);
    clock.set(20);
    expect(frames.waiting.size).toBe(0);
  });
});
