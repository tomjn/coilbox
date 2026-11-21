/** What the map view puts on its canvas (#3807), counted on a context that
 *  records the calls made to it. */
import { describe, expect, it } from "vitest";
import type { UnitIcons } from "./icons";
import {
  BLAST_FILL,
  emphasisedStyles,
  FAINT_UNITS,
  paintScene,
  styleOfColour,
  teamStyles,
} from "./paint";
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

/** A scene of one unit for each of teams 0 and 1. */
function two(): MapScene {
  const scene = one({});
  scene.units = 2;
  scene.unitX[1] = 5000;
  scene.unitZ[1] = 3000;
  scene.unitFx[1] = 0;
  scene.unitFz[1] = 1;
  scene.unitAcross[1] = 64;
  scene.unitAlong[1] = 64;
  scene.unitBuild[1] = 1;
  scene.unitTeam[1] = 1;
  return scene;
}

/** The fill of each team's finished units, with how much of it shows. */
function fillsOf(scene: MapScene, teams: ReturnType<typeof teamStyles>) {
  const ctx = recordingContext();
  paintScene(ctx, scene, view, teams, null);
  return ctx.calls
    .filter((c) => c.op === "fill")
    .map((c) => [c.fillStyle, c.globalAlpha] as const);
}

describe("the colour a team is drawn in", () => {
  it("is the one the page names for it, and the track's own when it names none", () => {
    const named = teamStyles(fixtureHeader.teams, new Map([[0, "#112233"]]));
    expect(named.get(0)?.fill).toBe("#112233");
    expect(named.get(1)).toEqual(teamStyles(fixtureHeader.teams).get(1));
  });

  it("gets a pale edge when it is dark and a dark one when it is light, in either notation", () => {
    expect(styleOfColour("#101010").edge).toBe(
      styleOfColour("rgb(16, 16, 16)").edge,
    );
    expect(styleOfColour("#101010").edge).not.toBe(
      styleOfColour("#f0f0f0").edge,
    );
    expect(styleOfColour("#f0f0f0").edge).toBe(
      styleOfColour("rgb(240, 240, 240)").edge,
    );
  });

  it("paints a unit in the colour named for its team", () => {
    const named = teamStyles(fixtureHeader.teams, new Map([[0, "#112233"]]));
    expect(fillsOf(one({}), named)).toEqual([["#112233", 1]]);
  });
});

describe("a team the players table leaves out or points past", () => {
  const base = teamStyles(fixtureHeader.teams);

  it("changes nothing when the table says nothing", () => {
    expect(emphasisedStyles(base, { hidden: [], active: null })).toBe(base);
  });

  it("draws an unticked team's units faint and every other team's whole", () => {
    const faint = emphasisedStyles(base, { hidden: [0], active: null });
    expect(fillsOf(two(), faint)).toEqual([
      [base.get(0)?.fill, FAINT_UNITS],
      [base.get(1)?.fill, 1],
    ]);
    // Faint units are still on the canvas, and in their own colour.
    expect(FAINT_UNITS).toBeGreaterThan(0);
  });

  it("keeps a faint unit under construction on the map, and fainter than a built one", () => {
    const faint = emphasisedStyles(base, { hidden: [0], active: null });
    const alphaOf = (build: number) => fillsOf(one({ build }), faint)[0][1];
    expect(alphaOf(0)).toBeGreaterThan(0);
    expect(alphaOf(0.5)).toBeLessThan(alphaOf(1));
  });

  it("fades every team but the one pointed at, and lights that one", () => {
    const pointed = emphasisedStyles(base, { hidden: [], active: [1] });
    expect(pointed.get(1)?.lit).toBe(true);
    expect(pointed.get(0)?.lit).toBe(false);
    expect(fillsOf(two(), pointed)).toEqual([
      [base.get(0)?.fill, FAINT_UNITS],
      [base.get(1)?.fill, 1],
    ]);
  });

  it("draws the team pointed at last, with a halo, even when it is the lower numbered", () => {
    const pointed = emphasisedStyles(base, { hidden: [], active: [0] });
    const ctx = recordingContext();
    paintScene(ctx, two(), view, pointed, null);
    const fills = ctx.calls.filter((c) => c.op === "fill");
    expect(fills.map((c) => c.fillStyle)).toEqual([
      base.get(1)?.fill,
      base.get(0)?.fill,
    ]);
    const strokes = ctx.calls.filter((c) => c.op === "stroke");
    // Team 0's edge is the halo, which team 1's is not.
    expect(strokes[0].strokeStyle).toBe(base.get(1)?.edge);
    expect(strokes[2].strokeStyle).not.toBe(base.get(0)?.edge);
  });

  it("does not light a team that is unticked", () => {
    const style = emphasisedStyles(base, { hidden: [0], active: [0, 1] });
    expect(style.get(0)).toMatchObject({ alpha: FAINT_UNITS, lit: false });
    expect(style.get(1)).toMatchObject({ alpha: 1, lit: true });
  });
});

/** A sprite the painter can draw, with the colour it was tinted in. */
interface FakeSprite {
  def: number;
  fill: string;
  lit: boolean;
  width: number;
  height: number;
}

/** Icons for the unit definitions in `edges`, which say each icon's edge in CSS
 *  pixels. Any other definition has none. */
function fakeIcons(edges: Record<number, number>): UnitIcons {
  return {
    edge: (def, ratio) => (edges[def] ?? 0) * ratio,
    sprite: (def, fill, lit, ratio) =>
      def in edges
        ? ({
            def,
            fill,
            lit,
            width: edges[def] * ratio,
            height: edges[def] * ratio,
          } satisfies FakeSprite as unknown as CanvasImageSource)
        : null,
  };
}

describe("a unit drawn as its game icon", () => {
  const base = teamStyles(fixtureHeader.teams);

  function paintedWith(
    scene: MapScene,
    icons: UnitIcons | null,
    teams: ReturnType<typeof teamStyles> = base,
    highlight: number | null = null,
  ) {
    const ctx = recordingContext();
    const counts = paintScene(ctx, scene, view, teams, highlight, icons);
    return { ctx, counts };
  }

  it("is drawn from the icon, centred on the unit, with no rectangle", () => {
    const scene = one({ x: 4096, z: 3072 });
    scene.unitDef[0] = 3;
    const { ctx, counts } = paintedWith(scene, fakeIcons({ 3: 12 }));
    expect(ctx.count("closePath")).toBe(0);
    expect(ctx.count("drawImage")).toBe(1);
    const draw = ctx.calls.find((c) => c.op === "drawImage");
    // The middle of the map is the middle of the canvas, and the icon is 12.
    expect(draw?.args).toEqual([512 - 6, 384 - 6]);
    expect(draw?.image).toMatchObject({ def: 3, width: 12 });
    expect(counts.icons).toBe(1);
  });

  it("is a rectangle when the unit has no icon, beside one that has", () => {
    const scene = two();
    scene.unitDef[0] = 3;
    scene.unitDef[1] = 4;
    const { ctx, counts } = paintedWith(scene, fakeIcons({ 3: 12 }));
    expect(ctx.count("drawImage")).toBe(1);
    expect(ctx.count("closePath")).toBe(1);
    expect(counts.icons).toBe(1);
    expect(counts.units).toBe(2);
  });

  it("is a rectangle while there are no icons", () => {
    const scene = one({});
    const { ctx, counts } = paintedWith(scene, null);
    expect(ctx.count("drawImage")).toBe(0);
    expect(ctx.count("closePath")).toBe(1);
    expect(counts.icons).toBe(0);
  });

  it("asks for the icon in its team's colour", () => {
    const named = teamStyles(fixtureHeader.teams, new Map([[0, "#112233"]]));
    const { ctx } = paintedWith(one({}), fakeIcons({ 0: 12 }), named);
    const image = ctx.calls.find((c) => c.op === "drawImage")
      ?.image as FakeSprite;
    expect(image.fill).toBe("#112233");
    expect(image.lit).toBe(false);
  });

  it("asks for the lit icon of the team pointed at, and a plain one of another", () => {
    const pointed = emphasisedStyles(base, { hidden: [], active: [1] });
    const scene = two();
    const { ctx } = paintedWith(scene, fakeIcons({ 0: 12 }), pointed);
    const lit = ctx.calls
      .filter((c) => c.op === "drawImage")
      .map((c) => (c.image as FakeSprite).lit);
    // Team 0 is left plain and drawn first, then team 1, which is lit.
    expect(lit).toEqual([false, true]);
  });

  it("is faint for a team the table leaves out and fainter still while it is built", () => {
    const faint = emphasisedStyles(base, { hidden: [0], active: null });
    const alphaOf = (build: number, teams = base) =>
      paintedWith(one({ build }), fakeIcons({ 0: 12 }), teams).ctx.calls.find(
        (c) => c.op === "drawImage",
      )?.globalAlpha ?? Number.NaN;
    expect(alphaOf(1)).toBe(1);
    expect(alphaOf(0.5)).toBeLessThan(1);
    expect(alphaOf(0)).toBeGreaterThan(0);
    expect(alphaOf(1, faint)).toBe(FAINT_UNITS);
    expect(alphaOf(0, faint)).toBeLessThan(FAINT_UNITS);
    expect(alphaOf(0, faint)).toBeGreaterThan(0);
  });

  it("is drawn above the start of the next team's rectangles and after its own", () => {
    const scene = two();
    scene.unitDef[0] = 0;
    scene.unitDef[1] = 1;
    const { ctx } = paintedWith(scene, fakeIcons({ 0: 12 }));
    // Team 0's icon is drawn, then team 1's rectangle.
    const ops = ctx.calls.map((c) => c.op);
    expect(ops.indexOf("drawImage")).toBeLessThan(ops.indexOf("closePath"));
  });

  it("is ringed by a ring that clears the icon", () => {
    const scene = one({});
    scene.unitSerial[0] = 5;
    scene.unitAcross[0] = 1;
    scene.unitAlong[0] = 1;
    const { ctx, counts } = paintedWith(scene, fakeIcons({ 0: 20 }), base, 5);
    expect(counts.highlighted).toBe(true);
    const arc = ctx.calls.find((c) => c.op === "arc");
    // Half the icon's edge, 10, reaches 10 root 2 to its corner.
    expect(arc?.args[2]).toBeGreaterThan(10 * Math.SQRT2);
  });
});

describe("the explosions in a picture", () => {
  /** A scene with only these circles: x, progress and whether it is a death. */
  function blasts(...circles: [number, number, boolean][]): MapScene {
    const scene = createMapScene();
    scene.blasts = circles.length;
    circles.forEach(([x, progress, death], i) => {
      scene.blastX[i] = x;
      scene.blastZ[i] = 3000;
      scene.blastProgress[i] = progress;
      scene.blastDeath[i] = death ? 1 : 0;
    });
    return scene;
  }

  function drawn(scene: MapScene) {
    const ctx = recordingContext();
    const counts = paintScene(ctx, scene, view, styles, null);
    return {
      counts,
      arcs: ctx.calls.filter((c) => c.op === "arc"),
      fills: ctx.calls.filter((c) => c.op === "fill"),
    };
  }

  it("draws a circle for each, in one fill for each band of opacity and no more", () => {
    // Five circles in two of the four bands: 0.1 and 0.2 are in the first, and
    // 0.6 to 0.74 in the third.
    const { counts, arcs, fills } = drawn(
      blasts(
        [1000, 0.1, false],
        [2000, 0.2, true],
        [3000, 0.6, false],
        [4000, 0.7, false],
        [5000, 0.74, true],
      ),
    );
    expect(counts.explosions).toBe(5);
    expect(arcs).toHaveLength(5);
    expect(fills).toHaveLength(2);
    expect(fills.every((f) => f.fillStyle === BLAST_FILL)).toBe(true);
  });

  it("costs the same number of fills for a thousand circles as for ten", () => {
    const many = (n: number) =>
      drawn(
        blasts(
          ...Array.from({ length: n }, (_, i): [number, number, boolean] => [
            (i * 7) % 8000,
            ((i % 12) + 1) / 13,
            i % 5 === 0,
          ]),
        ),
      ).fills.length;
    expect(many(1000)).toBe(many(10));
    expect(many(1000)).toBeLessThanOrEqual(4);
  });

  it("fades as it ages and grows as it ages", () => {
    const young = drawn(blasts([4000, 0.1, false]));
    const old = drawn(blasts([4000, 0.9, false]));
    expect(old.fills[0].globalAlpha).toBeLessThan(young.fills[0].globalAlpha);
    expect(old.arcs[0].args[2]).toBeGreaterThan(young.arcs[0].args[2]);
    // Faded out by the end, but still there while it is drawn.
    expect(old.fills[0].globalAlpha).toBeGreaterThan(0);
  });

  it("draws a unit's death larger than a shot landing", () => {
    const shot = drawn(blasts([4000, 0.5, false]));
    const death = drawn(blasts([4000, 0.5, true]));
    expect(death.arcs[0].args[2]).toBeGreaterThan(shot.arcs[0].args[2]);
  });

  it("draws the circle where the explosion was, with z down the picture", () => {
    const { arcs } = drawn(blasts([4000, 0.5, false]));
    expect(arcs[0].args[0]).toBeCloseTo(4000 * view.scale);
    expect(arcs[0].args[1]).toBeCloseTo(3000 * view.scale);
  });

  it("draws the circles of the fixture's frame, from the track", async () => {
    const track = testTrack();
    await track.seek(56);
    const scene = createMapScene();
    collectScene(track.handle, 56, scene, true);
    const { counts, arcs } = drawn(scene);
    // Shot 0 landed six frames before at 500, 400.
    expect(counts.explosions).toBe(1);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].args[0]).toBeCloseTo(500 * view.scale);
  });

  it("draws nothing for a picture with none", async () => {
    const { ctx, counts } = await painted(56);
    expect(counts.explosions).toBe(0);
    expect(ctx.count("arc")).toBe(0);
  });
});
