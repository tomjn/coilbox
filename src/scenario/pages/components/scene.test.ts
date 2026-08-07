import { describe, expect, it } from "vitest";
import {
  AUTHORING_PITCH,
  authoringCamera,
  clampToPlane,
  focusCamera,
  framingDistance,
  mapSceneStatus,
  sceneToWorld,
  worldToScene,
} from "./scene";

// A 4096 by 2048 elmo map, which the preview normalises to 100 by 50 scene
// units: the longer side becomes 100, so one elmo is 100/4096 scene units.
const W = 4096;
const H = 2048;
const SCALE = 100 / 4096;

describe("worldToScene", () => {
  it("puts the map's centre at the origin", () => {
    expect(worldToScene({ x: W / 2, z: H / 2 }, W, H, SCALE)).toEqual({
      x: 0,
      z: 0,
    });
  });

  it("puts engine (0,0) at the negative corner", () => {
    const p = worldToScene({ x: 0, z: 0 }, W, H, SCALE);
    expect(p.x).toBeCloseTo(-50);
    expect(p.z).toBeCloseTo(-25);
  });

  it("puts the far corner at the positive corner", () => {
    const p = worldToScene({ x: W, z: H }, W, H, SCALE);
    expect(p.x).toBeCloseTo(50);
    expect(p.z).toBeCloseTo(25);
  });

  it("round-trips through sceneToWorld", () => {
    const pos = { x: 1234, z: 567 };
    const back = sceneToWorld(worldToScene(pos, W, H, SCALE), W, H, SCALE);
    expect(back.x).toBeCloseTo(pos.x);
    expect(back.z).toBeCloseTo(pos.z);
  });

  it("returns positions off the map unchanged rather than clamping", () => {
    const back = sceneToWorld({ x: 80, z: 0 }, W, H, SCALE);
    expect(back.x).toBeGreaterThan(W);
  });
});

describe("framingDistance", () => {
  it("is bound by the depth axis on a tall viewport", () => {
    // Square map, aspect 1: both axes bind equally, so half the map subtends
    // half the 90 degree field, putting the camera one half-extent away.
    expect(framingDistance(100, 100, 1, 90)).toBeCloseTo(50 * 1.12);
  });

  it("moves further back as the viewport narrows", () => {
    const wide = framingDistance(100, 100, 2, 45);
    const narrow = framingDistance(100, 100, 0.5, 45);
    expect(narrow).toBeGreaterThan(wide);
  });

  it("survives a zero-width viewport", () => {
    expect(framingDistance(100, 100, 0, 45)).toBeGreaterThan(0);
    expect(Number.isFinite(framingDistance(100, 100, 0, 45))).toBe(true);
  });
});

describe("authoringCamera", () => {
  it("opens above and south of the map centre", () => {
    const cam = authoringCamera(100, 100, 16 / 9, 45, 300);
    expect(cam.x).toBe(0);
    expect(cam.y).toBeGreaterThan(0);
    expect(cam.z).toBeGreaterThan(0);
    // Steeper than 45 degrees, so the view reads as a plan rather than a vista.
    expect(cam.y).toBeGreaterThan(cam.z);
  });

  it("holds the pitch when the distance is capped", () => {
    const cam = authoringCamera(10000, 10000, 1, 45, 300);
    const d = Math.hypot(cam.y, cam.z);
    expect(d).toBeCloseTo(300);
    expect(Math.atan2(cam.y, cam.z)).toBeCloseTo(AUTHORING_PITCH);
  });
});

describe("focusCamera", () => {
  it("stands south of the point, at the distance asked for", () => {
    const cam = focusCamera({ x: 12, z: -30 }, 20);
    expect(cam.x).toBe(12);
    expect(cam.y).toBeGreaterThan(0);
    expect(cam.z).toBeGreaterThan(-30);
    expect(Math.hypot(cam.y, cam.z - -30)).toBeCloseTo(20);
  });

  it("looks down at the same pitch the opening view does", () => {
    const cam = focusCamera({ x: 0, z: 0 }, 20);
    expect(Math.atan2(cam.y, cam.z)).toBeCloseTo(AUTHORING_PITCH);
  });
});

describe("clampToPlane", () => {
  it("leaves a point over the map alone", () => {
    expect(clampToPlane({ x: 10, z: -5 }, 100, 50)).toEqual({ x: 10, z: -5 });
  });

  it("holds a point that has run off the edge", () => {
    expect(clampToPlane({ x: 900, z: -900 }, 100, 50)).toEqual({
      x: 50,
      z: -25,
    });
  });
});

describe("mapSceneStatus", () => {
  const base = {
    mapName: "Comet Catcher Redux",
    hasEngine: true,
    enginesLoading: false,
    assetsLoading: false,
    ready: false,
  };

  it("is no-map before a setup is chosen", () => {
    expect(mapSceneStatus({ ...base, mapName: "", ready: true })).toBe(
      "no-map",
    );
  });

  it("is ready once the assets are in, whatever else is still loading", () => {
    expect(mapSceneStatus({ ...base, ready: true, assetsLoading: true })).toBe(
      "ready",
    );
  });

  it("is loading while the engine list is still coming", () => {
    expect(mapSceneStatus({ ...base, enginesLoading: true })).toBe("loading");
  });

  it("is no-engine when nothing can read the map", () => {
    expect(mapSceneStatus({ ...base, hasEngine: false })).toBe("no-engine");
  });

  it("is error when an engine looked and came back with nothing", () => {
    expect(mapSceneStatus(base)).toBe("error");
  });
});
