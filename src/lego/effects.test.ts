import { describe, expect, it } from "vitest";
import {
  BITMAP_LASER,
  BITMAP_LASER_END,
  BITMAP_MUZZLE_FLAME,
  BITMAP_SMOKE,
  DEFAULT_FLAME_SIZE,
  emitPoint,
  type FlameEmission,
  NANO_DOTS_PER_FRAME,
  NANO_SPREAD,
  type NanoEmission,
  type Particles,
  particlesAt,
  type TracerEmission,
  unitFloat,
} from "./effects";

function nano(
  birth: number,
  overrides: Partial<NanoEmission> = {},
): NanoEmission {
  return {
    kind: "nano",
    birth,
    at: [0, 0, 0],
    to: [30, 0, 0],
    radius: 5,
    style: "builder",
    seed: birth,
    ...overrides,
  };
}

/**
 * Every dot drawn for `emission` at `age` sits along the line from `at` to
 * `to`, no further than its pace (3 elmos a frame for a builder, 1 for a
 * factory) times how long it can have been flying, scaled by at most one plus
 * its jitter. Only holds for a fixture whose `to` is straight out along x from
 * an `at` of the origin, which is every fixture in this file, so the x
 * coordinate is the along-track distance.
 */
function assertWithinTravel(
  emission: NanoEmission,
  age: number,
  particles: Particles,
) {
  const d = emission.to.map((v, i) => v - emission.at[i]);
  const len = Math.hypot(...d);
  const builder = emission.style === "builder";
  const pace = builder ? 3 : 1;
  const jitter = (builder ? emission.radius / len : 0.15) * NANO_SPREAD;
  const span = emission.span ?? 1;
  const flownMin = Math.max(0, age - span);
  const alongMin = pace * flownMin * (1 - jitter);
  const alongMax = pace * age * (1 + jitter);
  for (let i = 0; i < particles.count; i++) {
    const along = particles.centers[i * 3];
    expect(along).toBeGreaterThanOrEqual(alongMin - 1e-6);
    expect(along).toBeLessThanOrEqual(alongMax + 1e-6);
  }
}

describe("unitFloat", () => {
  it("is the same for the same seed and draw, and in [0, 1)", () => {
    expect(unitFloat(7, 2)).toBe(unitFloat(7, 2));
    for (let draw = 0; draw < 200; draw++) {
      const value = unitFloat(3, draw);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(unitFloat(7, 2)).not.toBe(unitFloat(8, 2));
  });
});

describe("particlesAt", () => {
  it("gives the same particles for the same frame, every time", () => {
    const emissions = [nano(0), nano(1), nano(2)];
    expect(particlesAt(emissions, 5)).toEqual(particlesAt(emissions, 5));
  });

  it("does not depend on the order frames were visited in", () => {
    const emissions = [nano(0), nano(4), nano(9)];
    const forwards = [3, 7, 12].map((frame) => particlesAt(emissions, frame));
    const backwards = [12, 7, 3].map((frame) => particlesAt(emissions, frame));
    expect(backwards.reverse()).toEqual(forwards);
  });

  /** `int(len / 3)` frames at 3 elmos a frame (`ProjectileHandler.cpp:742`),
   *  gone once the frame reaches its death frame (`NanoProjectile.cpp:71-77`),
   *  plus however many frames its span spreads its dots' departures over. */
  it("lives len / 3 frames for a builder, starting where it was emitted", () => {
    const emission = nano(10);
    expect(particlesAt([emission], 9).count).toBe(0);
    // Nothing has left the nozzle yet on the birth frame itself.
    expect(particlesAt([emission], 10).count).toBe(0);
    const born = particlesAt([emission], 11);
    expect(born.count).toBeGreaterThan(0);
    assertWithinTravel(emission, 1, born);
    const dying = particlesAt([emission], 20);
    expect(dying.count).toBeGreaterThan(0);
    assertWithinTravel(emission, 10, dying);
    expect(particlesAt([emission], 21).count).toBe(0);
  });

  it("moves a builder's particle three elmos a frame, give or take its jitter", () => {
    const emission = nano(0);
    const later = particlesAt([emission], 5);
    expect(later.count).toBeGreaterThan(0);
    assertWithinTravel(emission, 5, later);
  });

  /** A factory's lives `int(len)` frames at 1 elmo a frame (`:703`), plus
   *  however long its dots take to leave the nozzle. */
  it("lives len frames for a factory", () => {
    const emission = nano(0, { style: "factory" });
    expect(particlesAt([emission], 0).count).toBe(0);
    const born = particlesAt([emission], 1);
    expect(born.count).toBeGreaterThan(0);
    assertWithinTravel(emission, 1, born);
    const dying = particlesAt([emission], 30);
    expect(dying.count).toBeGreaterThan(0);
    assertWithinTravel(emission, 30, dying);
    expect(particlesAt([emission], 31).count).toBe(0);
  });

  it("keeps drawing more dots than an unspanned emission while a spanned one is still leaving the nozzle", () => {
    const stillLeaving = nano(0, { to: [9, 0, 0], span: 4 });
    const allLeftAtOnce = nano(0, { to: [9, 0, 0] });
    expect(particlesAt([stillLeaving], 3).count).toBeLessThan(
      NANO_DOTS_PER_FRAME,
    );
    expect(particlesAt([stillLeaving], 3.5).count).toBeGreaterThan(
      particlesAt([allLeftAtOnce], 3.5).count,
    );
  });

  it("varies its green from particle to particle, around the nano colour", () => {
    const emissions = Array.from({ length: 20 }, (_, birth) => nano(birth));
    const { colors, count } = particlesAt(emissions, 20);
    const greens = Array.from({ length: count }, (_, i) => colors[i * 3 + 1]);
    expect(new Set(greens).size).toBeGreaterThan(1);
    for (let i = 0; i < count; i++) {
      expect(colors[i * 3 + 1]).toBeGreaterThanOrEqual(colors[i * 3]);
    }
  });

  it("draws nothing for an emission with nowhere to go", () => {
    expect(particlesAt([nano(0, { to: [0, 0, 0] })], 0).count).toBe(0);
  });

  /** A long-dead emission is skipped whole, before its dots are even looped,
   *  so it neither draws nor changes what a still-alive emission draws. */
  it("a long-dead emission contributes nothing, however far past its death frame", () => {
    const longDead = nano(0); // life 10, well dead by frame 903
    const stillAlive = nano(900, { to: [9, 0, 0] }); // life 3
    const combined = particlesAt([longDead, stillAlive], 903);
    const aloneAlive = particlesAt([stillAlive], 903);
    expect(combined.count).toBeGreaterThan(0);
    expect(combined).toEqual(aloneAlive);
  });
});

describe("emitPoint", () => {
  it("emits from the origin along +Z for a piece with no vertices", () => {
    expect(emitPoint([])).toEqual({ pos: [0, 0, 0], dir: [0, 0, 1] });
  });

  it("emits from the origin along the vertex for a one-vertex piece", () => {
    expect(emitPoint([[1, 2, 3]])).toEqual({ pos: [0, 0, 0], dir: [1, 2, 3] });
  });

  it("emits from vertex 0 towards vertex 1 for a longer piece", () => {
    expect(
      emitPoint([
        [1, 2, 3],
        [1, 2, 5],
        [9, 9, 9],
      ]),
    ).toEqual({ pos: [1, 2, 3], dir: [0, 0, 2] });
  });
});

const flame: FlameEmission = {
  kind: "flame",
  birth: 10,
  at: [0, 0, 0],
  dir: [0, 0, 1],
  size: DEFAULT_FLAME_SIZE,
  seed: 3,
};

describe("the muzzle flame", () => {
  it("defaults to the size the weapon def defaults give", () => {
    expect(DEFAULT_FLAME_SIZE).toBeCloseTo(0.003);
  });

  // At the default size `fade` is 0.49 at age 1, 0.98 at age 2 and 1 from
  // age 3, so the flame quad, drawn only while `fade < 1`, shows for two
  // frames and the smoke quad for four.
  it("draws smoke for ages 1 to 4, the flame quad only while it has not faded, and nothing after", () => {
    for (const frame of [10, 11]) {
      const { sprites } = particlesAt([flame], frame);
      expect(sprites.count).toBe(2);
      expect(sprites.bitmaps[0]).toBe(BITMAP_SMOKE);
      expect(sprites.bitmaps[1]).toBe(BITMAP_MUZZLE_FLAME);
    }
    for (const frame of [12, 13]) {
      const { sprites } = particlesAt([flame], frame);
      expect(sprites.count).toBe(1);
      expect(sprites.bitmaps[0]).toBe(BITMAP_SMOKE);
    }
    expect(particlesAt([flame], 14).sprites.count).toBe(0);
    expect(particlesAt([flame], 9).sprites.count).toBe(0);
  });

  it("matches CMuzzleFlame::Draw on its first frame", () => {
    const { sprites } = particlesAt([flame], 10);
    const age = 1;
    const life = 4 + DEFAULT_FLAME_SIZE * 30;
    const alpha = 1 - age / life;
    const modAge = Math.sqrt(age + 2);
    const fade = Math.min(1, (1 - alpha) * 20 * 0.1);
    expect(sprites.halfSizes[0]).toBeCloseTo(modAge * 3);
    expect(sprites.colors[0]).toBeCloseTo(Math.trunc(180 * alpha * fade) / 255);
    expect(sprites.colors[3]).toBeCloseTo(Math.trunc(255 * alpha * fade) / 255);
    expect(sprites.colors[4]).toBeCloseTo(Math.trunc((1 - fade) * 255) / 255);
    expect(sprites.colors[7]).toBeCloseTo(1 / 255);
    // Along +Z from the piece, pulled back by size * 0.2 first.
    expect(sprites.centers[2]).toBeGreaterThan(0);
    // A flame sprite is a plain billboard, not a stretched bolt.
    expect(Array.from(sprites.axes.slice(0, 6))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(sprites.halfLengths[0]).toBe(0);
    expect(sprites.halfLengths[1]).toBe(0);
  });

  it("cycles the smoke bitmaps by quad", () => {
    const big = { ...flame, size: 1 };
    const { sprites } = particlesAt([big], 10, 2);
    const smoke = Array.from(sprites.bitmaps).filter(
      (bitmap) => bitmap >= BITMAP_SMOKE,
    );
    expect(smoke.slice(0, 4)).toEqual([
      BITMAP_SMOKE,
      BITMAP_SMOKE + 1,
      BITMAP_SMOKE,
      BITMAP_SMOKE + 1,
    ]);
  });
});

const tracer: TracerEmission = {
  kind: "tracer",
  birth: 20,
  at: [0, 0, 0],
  to: [0, 0, 100],
  seed: 1,
  weapon: 1,
};

describe("the tracer", () => {
  // Indices follow `CLaserProjectile::Draw`'s own order: the head cap's
  // outer and core quads, the bolt's outer and core quads, then the tail
  // cap's outer and core quads.
  const HEAD_CAP_OUTER = 0;
  const HEAD_CAP_CORE = 1;
  const BODY_OUTER = 2;
  const BODY_CORE = 3;
  const TAIL_CAP_OUTER = 4;
  const TAIL_CAP_CORE = 5;

  it("draws an outer bolt and a thinner core, both the laser bitmap, along the path", () => {
    const { sprites } = particlesAt([tracer], 22);
    expect(sprites.count).toBe(6);
    for (const i of [BODY_OUTER, BODY_CORE]) {
      expect(sprites.bitmaps[i]).toBe(BITMAP_LASER);
      expect(sprites.axes[i * 3]).toBeCloseTo(0);
      expect(sprites.axes[i * 3 + 1]).toBeCloseTo(0);
      expect(sprites.axes[i * 3 + 2]).toBeCloseTo(1);
    }
    expect(sprites.halfSizes[BODY_OUTER]).toBeGreaterThan(
      sprites.halfSizes[BODY_CORE],
    );
  });

  it("draws a head and a tail cap, stretched past the bolt's own ends, using the laser end bitmap", () => {
    const { sprites } = particlesAt([tracer], 22);
    const k = 2;
    const head = Math.min(k * 10, 100);
    const tail = Math.max(head - 40, 0);
    for (const i of [
      HEAD_CAP_OUTER,
      HEAD_CAP_CORE,
      TAIL_CAP_OUTER,
      TAIL_CAP_CORE,
    ]) {
      expect(sprites.bitmaps[i]).toBe(BITMAP_LASER_END);
    }
    // Each cap is stretched along the bolt's own axis, past the head in the
    // direction of travel and past the tail in the opposite direction,
    // following `CLaserProjectile::Draw`'s `texture2` quads
    // (`LaserProjectile.cpp:243-260,279-295`).
    expect(sprites.axes[HEAD_CAP_OUTER * 3 + 2]).toBeCloseTo(1);
    expect(sprites.axes[TAIL_CAP_OUTER * 3 + 2]).toBeCloseTo(-1);
    expect(sprites.halfLengths[HEAD_CAP_OUTER]).toBeGreaterThan(0);
    expect(sprites.halfLengths[TAIL_CAP_OUTER]).toBeGreaterThan(0);
    // The head cap bulges beyond the head, the tail cap beyond the tail.
    expect(sprites.centers[HEAD_CAP_OUTER * 3 + 2]).toBeGreaterThan(head);
    expect(sprites.centers[TAIL_CAP_OUTER * 3 + 2]).toBeLessThan(tail);
    expect(sprites.halfSizes[HEAD_CAP_OUTER]).toBeGreaterThan(
      sprites.halfSizes[HEAD_CAP_CORE],
    );
    expect(sprites.halfSizes[TAIL_CAP_OUTER]).toBeGreaterThan(
      sprites.halfSizes[TAIL_CAP_CORE],
    );
    // The near edge of each cap, at the bolt's own end, sits at the laser
    // end texture's midpoint, and the far edge at the outer edge of its own
    // half: `xstart` for the head, `xend` for the tail.
    expect(sprites.uvRanges[HEAD_CAP_OUTER * 2]).toBeCloseTo(0.5);
    expect(sprites.uvRanges[HEAD_CAP_OUTER * 2 + 1]).toBeCloseTo(0);
    expect(sprites.uvRanges[TAIL_CAP_OUTER * 2]).toBeCloseTo(0.5);
    expect(sprites.uvRanges[TAIL_CAP_OUTER * 2 + 1]).toBeCloseTo(1);
  });

  it("stretches from the clamped tail to the clamped head, centred between them", () => {
    const { sprites } = particlesAt([tracer], 22);
    const k = 2;
    const head = Math.min(k * 10, 100);
    const tail = Math.max(head - 40, 0);
    const mid = (head + tail) / 2;
    const halfLength = (head - tail) / 2;
    expect(sprites.centers[BODY_OUTER * 3 + 2]).toBeCloseTo(mid);
    expect(sprites.halfLengths[BODY_OUTER]).toBeCloseTo(halfLength);
    expect(sprites.centers[BODY_CORE * 3 + 2]).toBeCloseTo(mid);
    expect(sprites.halfLengths[BODY_CORE]).toBeCloseTo(halfLength);
  });

  /** `LaserProjectile.cpp:225-226` returns before drawing anything once the
   *  clamped bolt has no length, which is exactly true on the birth frame:
   *  head and tail are both clamped to zero. */
  it("draws nothing on its birth frame, before it has any length", () => {
    expect(particlesAt([tracer], 20).sprites.count).toBe(0);
  });

  it("starts at the muzzle on the first frame it draws anything", () => {
    const { sprites } = particlesAt([tracer], 21);
    expect(sprites.count).toBe(6);
    // The tail is still clamped to zero here, so the bolt's own tail edge,
    // its centre pulled back by its own half length, sits at the emit point.
    const tailZ =
      sprites.centers[BODY_OUTER * 3 + 2] -
      sprites.axes[BODY_OUTER * 3 + 2] * sprites.halfLengths[BODY_OUTER];
    expect(tailZ).toBeCloseTo(0);
  });

  it("is gone once the raw tail has passed the target", () => {
    expect(particlesAt([tracer], 20 + 100).sprites.count).toBe(0);
  });

  it("moves towards the target frame by frame", () => {
    const centerZ = (frame: number) =>
      particlesAt([tracer], frame).sprites.centers[BODY_OUTER * 3 + 2];
    expect(centerZ(24)).toBeGreaterThan(centerZ(22));
  });
});

describe("a tracer's colour by weapon", () => {
  const BODY_OUTER = 2;
  const BODY_CORE = 3;

  it("keeps weapon 1's original warm white-gold outer and white core", () => {
    const { sprites } = particlesAt([tracer], 22);
    const outer = sprites.colors.slice(BODY_OUTER * 4, BODY_OUTER * 4 + 3);
    const core = sprites.colors.slice(BODY_CORE * 4, BODY_CORE * 4 + 3);
    expect(outer[0]).toBeCloseTo(1);
    expect(outer[1]).toBeCloseTo(0.85);
    expect(outer[2]).toBeCloseTo(0.6);
    expect(core[0]).toBeCloseTo(1);
    expect(core[1]).toBeCloseTo(1);
    expect(core[2]).toBeCloseTo(1);
  });

  it("draws weapon 2 in a different colour from weapon 1", () => {
    const weapon2: TracerEmission = { ...tracer, weapon: 2 };
    const one = particlesAt([tracer], 22).sprites.colors.slice(
      BODY_OUTER * 4,
      BODY_OUTER * 4 + 3,
    );
    const two = particlesAt([weapon2], 22).sprites.colors.slice(
      BODY_OUTER * 4,
      BODY_OUTER * 4 + 3,
    );
    expect(Array.from(two)).not.toEqual(Array.from(one));
  });

  it("draws weapon 3 in a colour different from weapons 1 and 2", () => {
    const weapon2: TracerEmission = { ...tracer, weapon: 2 };
    const weapon3: TracerEmission = { ...tracer, weapon: 3 };
    const two = particlesAt([weapon2], 22).sprites.colors.slice(
      BODY_OUTER * 4,
      BODY_OUTER * 4 + 3,
    );
    const three = particlesAt([weapon3], 22).sprites.colors.slice(
      BODY_OUTER * 4,
      BODY_OUTER * 4 + 3,
    );
    expect(Array.from(three)).not.toEqual(Array.from(two));
  });

  it("cycles weapon 4 back to weapon 1's colour", () => {
    const weapon1 = particlesAt([tracer], 22).sprites.colors;
    const weapon4: TracerEmission = { ...tracer, weapon: 4 };
    const four = particlesAt([weapon4], 22).sprites.colors;
    expect(Array.from(four)).toEqual(Array.from(weapon1));
  });
});

describe("particlesAt with flames and tracers", () => {
  it("gives the same arrays for the same frame, in any visiting order", () => {
    const emissions = [flame, tracer];
    const first = particlesAt(emissions, 21);
    particlesAt(emissions, 11);
    particlesAt(emissions, 30);
    expect(particlesAt(emissions, 21)).toEqual(first);
  });

  it("keeps nano on the dots and everything else on the sprites", () => {
    const { count, sprites } = particlesAt([flame], 10);
    expect(count).toBe(0);
    expect(sprites.count).toBeGreaterThan(0);
  });
});
