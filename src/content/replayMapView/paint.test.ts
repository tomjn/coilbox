/** What the map view puts on its canvas (#3807), counted on a context that
 *  records the calls made to it. */
import { describe, expect, it } from "vitest";
import { paintScene, teamStyles } from "./paint";
import { collectScene, createMapScene, type MapScene } from "./scene";
import {
  fixtureAlive,
  fixtureHeader,
  recordingContext,
  testTrack,
} from "./testTrack";

const styles = teamStyles(fixtureHeader.teams);
/** A canvas 1,024 pixels wide for the fixture's 8,192 elmo map. */
const view = { width: 1024, height: 768, scale: 1024 / 8192, pixelRatio: 1 };

async function painted(frame: number, highlight: number | null = null) {
  const track = testTrack();
  await track.seek(frame);
  const scene = createMapScene();
  collectScene(track.handle, frame, scene);
  const ctx = recordingContext();
  const counts = paintScene(ctx, scene, view, styles, highlight);
  return { ctx, counts, scene, handle: track.handle };
}

function one(over: Partial<Record<"x" | "z" | "fx" | "fz" | "build", number>>) {
  const scene: MapScene = createMapScene();
  scene.units = 1;
  scene.unitX[0] = over.x ?? 4000;
  scene.unitZ[0] = over.z ?? 3000;
  scene.unitFx[0] = over.fx ?? 0;
  scene.unitFz[0] = over.fz ?? 1;
  scene.unitAcross[0] = 64;
  scene.unitAlong[0] = 64;
  scene.unitBuild[0] = over.build ?? 1;
  scene.unitTeam[0] = 0;
  return scene;
}

/** The two ends of the only line drawn after the unit's outline. */
function facingLine(scene: MapScene) {
  const ctx = recordingContext();
  paintScene(ctx, scene, view, styles, null);
  const close = ctx.calls.findIndex((c) => c.op === "closePath");
  const rest = ctx.calls.slice(close + 1);
  const from = rest.find((c) => c.op === "moveTo");
  const to = rest[rest.indexOf(from as (typeof rest)[number]) + 1];
  expect(to.op).toBe("lineTo");
  return { from: from?.args ?? [], to: to.args };
}

describe("paintScene", () => {
  it("draws one mark for each live unit at three times in the fixture, and more", async () => {
    for (const { frame, units } of fixtureAlive) {
      const { ctx, counts, handle } = await painted(frame);
      // A unit's mark is the only closed outline the painter draws.
      expect([frame, ctx.count("closePath")]).toEqual([frame, units]);
      expect([frame, counts.units]).toEqual([frame, units]);
      expect([frame, counts.units]).toEqual([frame, handle.unitCountAt(frame)]);
    }
    expect(
      fixtureAlive.filter((a) => a.units > 0).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("draws a unit under construction fainter than a built one", () => {
    const alphaOf = (build: number) => {
      const ctx = recordingContext();
      paintScene(ctx, one({ build }), view, styles, null);
      return ctx.calls.find((c) => c.op === "fill")?.globalAlpha ?? Number.NaN;
    };
    expect(alphaOf(1)).toBe(1);
    expect(alphaOf(0.5)).toBeLessThan(alphaOf(1));
    expect(alphaOf(0.1)).toBeLessThan(alphaOf(0.5));
    // A unit that has only just been started can still be seen.
    expect(alphaOf(0)).toBeGreaterThan(0);
  });

  it("draws the fixture's half built unit fainter than its finished one", async () => {
    // At frame 30 unit 0 is three quarters built and unit 1 is half built.
    const { ctx } = await painted(30);
    const fills = ctx.calls
      .filter((c) => c.op === "fill")
      .map((c) => c.globalAlpha);
    expect(fills.length).toBe(2);
    expect(Math.min(...fills)).toBeLessThan(Math.max(...fills));
    expect(Math.max(...fills)).toBeLessThan(1);
  });

  it("points the facing line the way the unit faces, with z down the picture", () => {
    const down = facingLine(one({ fx: 0, fz: 1 }));
    expect(down.to[0]).toBeCloseTo(down.from[0]);
    expect(down.to[1]).toBeGreaterThan(down.from[1]);

    const up = facingLine(one({ fx: 0, fz: -1 }));
    expect(up.to[1]).toBeLessThan(up.from[1]);

    const right = facingLine(one({ fx: 1, fz: 0 }));
    expect(right.to[1]).toBeCloseTo(right.from[1]);
    expect(right.to[0]).toBeGreaterThan(right.from[0]);

    const left = facingLine(one({ fx: -1, fz: 0 }));
    expect(left.to[0]).toBeLessThan(left.from[0]);
  });

  it("puts a unit where it is on the map", () => {
    const ctx = recordingContext();
    paintScene(ctx, one({ x: 4096, z: 3072 }), view, styles, null);
    const corners = ctx.calls
      .slice(
        0,
        ctx.calls.findIndex((c) => c.op === "closePath"),
      )
      .filter((c) => c.op === "moveTo" || c.op === "lineTo");
    expect(corners.length).toBe(4);
    const mean = (i: number) =>
      corners.reduce((sum, c) => sum + c.args[i], 0) / 4;
    // The middle of the map is the middle of the canvas.
    expect([mean(0), mean(1)]).toEqual([512, 384]);
    // 128 elmos of footprint at an eighth of a pixel an elmo is 16 pixels.
    const xs = corners.map((c) => c.args[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(16);
  });

  it("never draws a mark smaller than the least size, however small the footprint", () => {
    const scene = one({});
    scene.unitAcross[0] = 1;
    scene.unitAlong[0] = 1;
    const ctx = recordingContext();
    paintScene(ctx, scene, { ...view, pixelRatio: 2 }, styles, null);
    const xs = ctx.calls
      .slice(
        0,
        ctx.calls.findIndex((c) => c.op === "closePath"),
      )
      .filter((c) => c.op === "moveTo" || c.op === "lineTo")
      .map((c) => c.args[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(6);
  });

  it("draws a unit in its team's colour", async () => {
    const { ctx } = await painted(100);
    // The fill after each closed outline. The wreck at this frame is a rect.
    const fills = ctx.calls
      .filter(
        (c, i) =>
          c.op === "fill" &&
          ctx.calls.slice(0, i).some((b) => b.op === "closePath"),
      )
      .map((c) => c.fillStyle);
    // Unit 0 is team 0, red, and unit 2 is team 1, blue.
    expect(fills).toEqual(["rgb(255, 0, 10)", "rgb(0, 128, 255)"]);
  });

  it("draws a projectile as a line along its velocity, and none when there is none", async () => {
    // At frame 30 projectile 0 is at 300, 300 moving 10, 5 a frame.
    const { ctx, counts } = await painted(30);
    expect(counts.projectiles).toBe(1);
    const stroke = ctx.calls.findLast((c) => c.op === "lineTo");
    const start =
      ctx.calls[
        ctx.calls.lastIndexOf(stroke as (typeof ctx.calls)[number]) - 1
      ];
    expect(start.op).toBe("moveTo");
    const [dx, dz] = [
      (stroke?.args[0] ?? 0) - start.args[0],
      (stroke?.args[1] ?? 0) - start.args[1],
    ];
    // The head is at the projectile and the line runs back along 10, 5.
    expect(stroke?.args[0]).toBeCloseTo(300 / 8);
    expect(stroke?.args[1]).toBeCloseTo(300 / 8);
    expect(dx).toBeGreaterThan(0);
    expect(dz / dx).toBeCloseTo(0.5);

    expect((await painted(120)).counts.projectiles).toBe(0);
  });

  it("draws a wreck as a small grey square while it exists", async () => {
    expect((await painted(39)).ctx.count("rect")).toBe(0);
    const { ctx, counts } = await painted(40);
    expect(counts.wrecks).toBe(1);
    expect(ctx.count("rect")).toBe(1);
    const rect = ctx.calls.find((c) => c.op === "rect");
    expect((rect?.args[0] ?? 0) + (rect?.args[2] ?? 0) / 2).toBeCloseTo(
      1200.5 / 8,
    );
  });

  it("rings the unit that is pointed at and no other", async () => {
    expect((await painted(100, null)).ctx.count("arc")).toBe(0);
    expect((await painted(100, 2)).ctx.count("arc")).toBe(1);
    const { ctx, counts } = await painted(100, 99);
    expect(ctx.count("arc")).toBe(0);
    expect(counts.highlighted).toBe(false);
  });
});
