/**
 * What the map view collects from a track at a frame (#3807), against the
 * fixture the Rust reader wrote.
 */
import { describe, expect, it } from "vitest";
import { collectScene, createMapScene, unitAt } from "./scene";
import { fixtureAlive, fixtureHeader, testTrack } from "./testTrack";

async function sceneAt(frame: number) {
  const track = testTrack();
  await track.seek(frame);
  const scene = createMapScene();
  expect(collectScene(track.handle, frame, scene)).toBe(true);
  return { scene, handle: track.handle };
}

describe("collectScene", () => {
  it("has as many units as the track has alive, at every frame the Rust reader counted", async () => {
    expect(fixtureAlive.length).toBeGreaterThanOrEqual(3);
    for (const { frame, units, projectiles } of fixtureAlive) {
      const { scene, handle } = await sceneAt(frame);
      expect([frame, scene.units]).toEqual([frame, handle.unitCountAt(frame)]);
      expect([frame, scene.units]).toEqual([frame, units]);
      expect([frame, scene.projectiles]).toEqual([frame, projectiles]);
    }
  });

  it("gives each unit half its definition's footprint", async () => {
    const { scene } = await sceneAt(45);
    // Unit 0 is an armcom, 32 by 48 elmos. Unit 1 is an armpw, 16 by 16.
    expect(fixtureHeader.unitFootprints).toEqual([
      [32, 48],
      [16, 16],
    ]);
    const sizes = Array.from({ length: scene.units }, (_, i) => [
      scene.unitSerial[i],
      scene.unitAcross[i],
      scene.unitAlong[i],
    ]);
    expect(sizes).toEqual([
      [0, 16, 24],
      [1, 8, 8],
    ]);
  });

  it("leaves the scene as it was while the frame's window is loading", async () => {
    const track = testTrack();
    await track.seek(45);
    const scene = createMapScene();
    collectScene(track.handle, 45, scene);
    track.handle.follow(149, 1);
    expect(collectScene(track.handle, 149, scene)).toBe(false);
    expect([scene.frame, scene.units]).toEqual([45, 2]);
  });

  it("has a projectile from its first frame to its last and not either side", async () => {
    // Projectile 0 lives from frame 10 to 50.
    for (const [frame, count] of [
      [9, 0],
      [10, 1],
      [50, 2],
      [51, 1],
    ]) {
      expect([frame, (await sceneAt(frame)).scene.projectiles]).toEqual([
        frame,
        count,
      ]);
    }
  });

  it("has a wreck from the frame it appears to the frame it goes", async () => {
    // The fixture's first feature appears at frame 40 and stays.
    expect((await sceneAt(39)).scene.wrecks).toBe(0);
    const { scene } = await sceneAt(40);
    expect(scene.wrecks).toBe(1);
    expect([scene.wreckX[0], scene.wreckZ[0]]).toEqual([1200.5, 300.25]);

    const gone = testTrack({
      ...fixtureHeader,
      features: { ...fixtureHeader.features, last: [100, 150] },
    });
    await gone.seek(100);
    const at = createMapScene();
    collectScene(gone.handle, 100, at);
    expect(at.wrecks).toBe(1);
    await gone.seek(101);
    collectScene(gone.handle, 101, at);
    expect(at.wrecks).toBe(0);
  });

  it("leaves out a feature that was on the map before the match began", async () => {
    // The fixture's second feature is there from the first frame: scenery,
    // which the map's picture already shows.
    expect(fixtureHeader.features.first).toEqual([40, 0]);
    expect((await sceneAt(0)).scene.wrecks).toBe(0);
  });
});

describe("unitAt", () => {
  it("finds the unit a point is on and none where there is no unit", async () => {
    const { scene } = await sceneAt(30);
    // Unit 1 is at 3000, 2000 at frame 30 and unit 0 is far from it.
    const hit = unitAt(scene, 3003, 1998, 0, 0);
    expect(hit).toBeGreaterThanOrEqual(0);
    expect(scene.unitSerial[hit]).toBe(1);
    expect(unitAt(scene, 5000, 5000, 0, 0)).toBe(-1);
  });

  it("reaches a small unit through the least size a mark is drawn at", async () => {
    const { scene } = await sceneAt(30);
    // 40 elmos off a unit whose half footprint is 8.
    expect(unitAt(scene, 3040, 2000, 0, 0)).toBe(-1);
    expect(scene.unitSerial[unitAt(scene, 3040, 2000, 45, 0)]).toBe(1);
  });

  it("takes the nearer of two units that both cover the point", () => {
    const scene = createMapScene();
    scene.units = 2;
    scene.unitX.set([100, 110]);
    scene.unitZ.set([100, 100]);
    scene.unitFx.set([0, 0]);
    scene.unitFz.set([1, 1]);
    scene.unitAcross.set([20, 20]);
    scene.unitAlong.set([20, 20]);
    scene.unitSerial.set([7, 8]);
    expect(scene.unitSerial[unitAt(scene, 108, 100, 0, 0)]).toBe(8);
  });

  it("measures along the way a unit faces", () => {
    const scene = createMapScene();
    scene.units = 1;
    scene.unitX.set([100]);
    scene.unitZ.set([100]);
    // Facing along x, 4 across and 40 along.
    scene.unitFx.set([1]);
    scene.unitFz.set([0]);
    scene.unitAcross.set([2]);
    scene.unitAlong.set([20]);
    expect(unitAt(scene, 118, 100, 0, 0)).toBe(0);
    expect(unitAt(scene, 100, 118, 0, 0)).toBe(-1);
  });
});
