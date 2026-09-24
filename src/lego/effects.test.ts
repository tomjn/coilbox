import { describe, expect, it } from "vitest";
import {
  BITMAP_EXPLO,
  BITMAP_HEATCLOUD,
  BITMAP_LASER,
  BITMAP_LASER_END,
  BITMAP_MUZZLE_FLAME,
  BITMAP_SMOKE,
  BITMAP_WAKE,
  BURST_SCALE,
  DEFAULT_FLAME_SIZE,
  type Emission,
  emitPoint,
  type FlameEmission,
  NANO_DOTS_PER_FRAME,
  NANO_SPREAD,
  type NanoEmission,
  type Particles,
  PUFF_LIFE,
  type PuffEmission,
  particlesAt,
  SFX_TRACER_RANGE,
  type SmokeEmission,
  sfxEmission,
  type TracerEmission,
  travelled,
  type UnitMotion,
  unitFloat,
  unitMotion,
  type Vec3,
  type VtolEmission,
  WAKE_LIFT,
  type WakeEmission,
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

  it("turns every flame and tracer sprite to the camera, with no side of its own", () => {
    const { sprites } = particlesAt(
      [
        {
          kind: "flame",
          birth: 0,
          at: [0, 0, 0],
          dir: [0, 0, 1],
          size: DEFAULT_FLAME_SIZE,
          seed: 1,
        },
        {
          kind: "tracer",
          birth: 0,
          at: [0, 0, 0],
          to: [0, 0, 100],
          seed: 2,
          weapon: 1,
        },
      ],
      2,
    );
    expect(sprites.count).toBeGreaterThan(0);
    expect(sprites.sides).toHaveLength(sprites.count * 3);
    expect(sprites.sides.every((value) => value === 0)).toBe(true);
  });
});

/** `CSmokeProjectile::Update` replayed step by step in 32-bit floats, as the
 *  engine runs it, with no wind (`SmokeProjectile.cpp:85-98`). Null once the
 *  particle has been deleted. */
function replaySmoke(updates: number): { size: number; age: number } | null {
  const ageSpeed = Math.fround(1 / 60);
  let age = 0;
  let size = 0;
  for (let i = 0; i < updates; i++) {
    age = Math.fround(age + ageSpeed);
    size = Math.fround(size + 0.5);
    if (size < 4) size = Math.fround(size + (4 - size) * 0.2);
    age = Math.min(age, 1);
    if (age >= 1) return null;
  }
  return { size, age };
}

function smoke(overrides: Partial<SmokeEmission> = {}): SmokeEmission {
  return {
    kind: "smoke",
    birth: 0,
    at: [0, 0, 0],
    color: 0.5,
    seed: 7,
    ...overrides,
  };
}

describe("sfx smoke", () => {
  it("grows and dies as a direct replay of CSmokeProjectile::Update does", () => {
    for (let k = 0; k < 70; k++) {
      const replay = replaySmoke(k + 1);
      const { sprites } = particlesAt([smoke()], k);
      if (replay === null) {
        expect(sprites.count).toBe(0);
        continue;
      }
      expect(sprites.count).toBe(1);
      expect(sprites.halfSizes[0]).toBeCloseTo(replay.size, 4);
    }
  });

  it("fades as CSmokeProjectile::Draw does, black smoke a little lighter than white", () => {
    const replay = replaySmoke(1);
    if (!replay) throw new Error("smoke died on its first update");
    const alpha = Math.trunc((1 - replay.age) * 255);
    const white = particlesAt([smoke()], 0).sprites.colors;
    expect(white[0]).toBeCloseTo(Math.trunc(0.5 * alpha) / 255, 6);
    expect(white[3]).toBeCloseTo(alpha / 255, 6);
    const black = particlesAt([smoke({ color: 0.6 })], 0).sprites.colors;
    expect(black[0]).toBeCloseTo(Math.trunc(0.6 * alpha) / 255, 6);
  });

  it("rises 1.1 elmos a frame, give or take half an elmo in each direction", () => {
    const { sprites } = particlesAt([smoke()], 9);
    expect(sprites.centers[1]).toBeGreaterThanOrEqual(10 * 0.6 - 1e-4);
    expect(sprites.centers[1]).toBeLessThanOrEqual(10 * 1.6 + 1e-4);
    expect(Math.abs(sprites.centers[0])).toBeLessThanOrEqual(5 + 1e-4);
  });

  it("draws nothing before its birth frame", () => {
    expect(particlesAt([smoke({ birth: 5 })], 4).sprites.count).toBe(0);
  });

  it("picks one of the game's smoke bitmaps by its seed", () => {
    const picked = new Set<number>();
    for (let seed = 0; seed < 50; seed++) {
      picked.add(particlesAt([smoke({ seed })], 0, 4).sprites.bitmaps[0]);
    }
    for (const bitmap of picked) {
      expect(bitmap).toBeGreaterThanOrEqual(BITMAP_SMOKE);
      expect(bitmap).toBeLessThan(BITMAP_SMOKE + 4);
    }
    expect(picked.size).toBeGreaterThan(1);
  });
});

function vtol(dir: Vec3, overrides: Partial<VtolEmission> = {}): VtolEmission {
  return { kind: "vtol", birth: 0, at: [0, 0, 0], dir, seed: 3, ...overrides };
}

describe("sfx VTOL", () => {
  it("moves at half the emit direction a frame, always downward", () => {
    const sideways = particlesAt([vtol([0.6, 0.8, 0])], 0).sprites.centers;
    expect(sideways[0]).toBeCloseTo(0.3, 6);
    expect(sideways[1]).toBeCloseTo(-0.4, 6);
    expect(sideways[2]).toBeCloseTo(0, 6);
    const down = particlesAt([vtol([0, -1, 0])], 0).sprites.centers;
    expect(down[1]).toBeCloseTo(-0.5, 6);
  });

  it("starts at size 3 and lives as many frames as its temperature", () => {
    for (let seed = 0; seed < 30; seed++) {
      const first = particlesAt([vtol([0, 0, 1], { seed })], 0).sprites;
      expect(first.halfSizes[0]).toBeGreaterThanOrEqual(3.2 - 1e-6);
      expect(first.halfSizes[0]).toBeLessThanOrEqual(3.5 + 1e-6);
      expect(particlesAt([vtol([0, 0, 1], { seed })], 8).sprites.count).toBe(1);
      expect(particlesAt([vtol([0, 0, 1], { seed })], 14).sprites.count).toBe(
        0,
      );
    }
  });

  it("glows by its heat with the heat cloud bitmap and almost no alpha", () => {
    const { sprites } = particlesAt([vtol([0, 0, 1])], 0);
    expect(sprites.bitmaps[0]).toBe(BITMAP_HEATCLOUD);
    expect(sprites.colors[3]).toBeCloseTo(1 / 255, 6);
    expect(sprites.colors[0]).toBeGreaterThanOrEqual(229 / 255 - 1e-6);
    expect(sprites.colors[0]).toBeLessThanOrEqual(238 / 255 + 1e-6);
  });
});

function wake(dir: Vec3, overrides: Partial<WakeEmission> = {}): WakeEmission {
  return {
    kind: "wake",
    birth: 0,
    at: [0, 20, 0],
    dir,
    reverse: false,
    seed: 11,
    ...overrides,
  };
}

describe("sfx wake", () => {
  it("lies flat on the ground, whatever height it was emitted at", () => {
    const { sprites } = particlesAt([wake([1, 0, 0])], 0);
    expect(sprites.count).toBe(1);
    expect(sprites.centers[1]).toBe(WAKE_LIFT);
    expect(sprites.bitmaps[0]).toBe(BITMAP_WAKE);
    const axis = Array.from(sprites.axes.slice(0, 3));
    const side = Array.from(sprites.sides.slice(0, 3));
    expect(axis[1]).toBe(0);
    expect(side[1]).toBe(0);
    expect(Math.hypot(...axis)).toBeCloseTo(1, 6);
    expect(Math.hypot(...side)).toBeCloseTo(1, 6);
    expect(axis[0] * side[0] + axis[2] * side[2]).toBeCloseTo(0, 6);
    expect(sprites.halfLengths[0]).toBe(sprites.halfSizes[0]);
  });

  it("starts 6 to 10 elmos across and grows 0.15 to 0.45 a frame", () => {
    const { halfSizes } = particlesAt([wake([1, 0, 0])], 0).sprites;
    expect(halfSizes[0]).toBeGreaterThanOrEqual(6.15 - 1e-6);
    expect(halfSizes[0]).toBeLessThanOrEqual(10.45 + 1e-6);
  });

  it("fades up over four frames, then out, with the same value in every channel", () => {
    const alphas = Array.from({ length: 8 }, (_, k) => {
      const { colors } = particlesAt([wake([1, 0, 0])], k).sprites;
      expect(colors[0]).toBe(colors[3]);
      return colors[3];
    });
    for (let k = 1; k < 4; k++)
      expect(alphas[k]).toBeGreaterThan(alphas[k - 1]);
    for (let k = 4; k < 8; k++) expect(alphas[k]).toBeLessThan(alphas[k - 1]);
  });

  it("lasts until its alpha runs out at 0.004 a frame", () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(particlesAt([wake([1, 0, 0], { seed })], 70).sprites.count).toBe(
        1,
      );
      expect(particlesAt([wake([1, 0, 0], { seed })], 130).sprites.count).toBe(
        0,
      );
    }
  });

  it("drifts 0.4 elmos a frame along the emit direction, or back along it in reverse", () => {
    const dir: Vec3 = [0.6, 0.8, 0];
    const ahead = particlesAt([wake(dir)], 49).sprites.centers[0];
    const behind = particlesAt([wake(dir, { reverse: true })], 49).sprites
      .centers[0];
    expect(Math.abs(ahead - 50 * 0.4 * 0.6)).toBeLessThanOrEqual(2 + 1e-4);
    expect(Math.abs(behind + 50 * 0.4 * 0.6)).toBeLessThanOrEqual(2 + 1e-4);
  });
});

function puff(overrides: Partial<PuffEmission> = {}): PuffEmission {
  return {
    kind: "puff",
    birth: 0,
    at: [0, 0, 0],
    dir: [0, 1, 0],
    seed: 5,
    ...overrides,
  };
}

describe("the CEG puff and the detonation burst", () => {
  it("drifts along the emit direction, grows, and fades, with the explo bitmap", () => {
    const early = particlesAt([puff()], 0).sprites;
    const later = particlesAt([puff()], 5).sprites;
    expect(early.bitmaps[0]).toBe(BITMAP_EXPLO);
    expect(later.centers[1]).toBeGreaterThan(early.centers[1]);
    expect(later.centers[0]).toBe(0);
    expect(later.halfSizes[0]).toBeGreaterThan(early.halfSizes[0]);
    expect(later.colors[0]).toBeLessThan(early.colors[0]);
  });

  it("is gone once it has lived PUFF_LIFE updates", () => {
    expect(particlesAt([puff()], PUFF_LIFE - 2).sprites.count).toBe(1);
    expect(particlesAt([puff()], PUFF_LIFE - 1).sprites.count).toBe(0);
  });

  it("draws a burst as the same puff, BURST_SCALE times the size", () => {
    const small = particlesAt([puff()], 3).sprites.halfSizes[0];
    const big = particlesAt([puff({ kind: "burst" })], 3).sprites.halfSizes[0];
    expect(big).toBeCloseTo(small * BURST_SCALE, 6);
  });
});

describe("sfxEmission", () => {
  const at: Vec3 = [1, 2, 3];
  const dir: Vec3 = [0, 0, 1];
  const kindOf = (sfx: number) => sfxEmission(sfx, 4, at, dir, 9)?.kind ?? null;

  it("reads the built-in numbers", () => {
    expect(kindOf(0)).toBe("vtol");
    for (const sfx of [2, 3, 4, 5]) expect(kindOf(sfx)).toBe("wake");
    expect(sfxEmission(2, 4, at, dir, 9)).toMatchObject({ reverse: false });
    expect(sfxEmission(3, 4, at, dir, 9)).toMatchObject({ reverse: false });
    expect(sfxEmission(4, 4, at, dir, 9)).toMatchObject({ reverse: true });
    expect(sfxEmission(5, 4, at, dir, 9)).toMatchObject({ reverse: true });
    expect(sfxEmission(257, 4, at, dir, 9)).toMatchObject({
      kind: "smoke",
      color: 0.5,
    });
    expect(sfxEmission(258, 4, at, dir, 9)).toMatchObject({
      kind: "smoke",
      color: 0.6,
    });
  });

  it("draws nothing for a bubble or a number the engine does not know", () => {
    for (const sfx of [259, 1, 6, 256, 260, 1023]) {
      expect(kindOf(sfx)).toBeNull();
    }
  });

  it("reads the range bits", () => {
    expect(kindOf(1024 + 3)).toBe("puff");
    expect(kindOf(16384 + 2)).toBe("puff");
    expect(kindOf(4096 + 1)).toBe("burst");
    expect(sfxEmission(2048 + 1, 4, at, dir, 9)).toEqual({
      kind: "tracer",
      birth: 4,
      at,
      to: [1, 2, 3 + SFX_TRACER_RANGE],
      seed: 9,
      weapon: 2,
    });
  });

  it("tests the range bits in the engine's order, after the exact numbers", () => {
    expect(kindOf(1024 + 257)).toBe("puff");
    expect(kindOf(16384 + 2048)).toBe("puff");
    expect(kindOf(1024 + 2048)).toBe("puff");
    expect(kindOf(2048 + 4096)).toBe("tracer");
  });

  it("keeps the emission's birth, place and direction", () => {
    expect(sfxEmission(1024, 4, at, dir, 9)).toEqual({
      kind: "puff",
      birth: 4,
      at,
      dir,
      seed: 9,
    });
  });
});

describe("particles carried back by a moving unit", () => {
  const moving: UnitMotion = { speed: 2, spans: [[10, 40]] };

  it("reads when the unit moves from its StartMoving and StopMoving call-ins", () => {
    expect(
      unitMotion(
        [
          { frame: 0, callin: "Create" },
          { frame: 15, callin: "StartMoving" },
          { frame: 225, callin: "StopMoving" },
        ],
        1.5,
      ),
    ).toEqual({ speed: 1.5, spans: [[15, 225]] });
    expect(unitMotion([{ frame: 15, callin: "StartMoving" }], 1)).toEqual({
      speed: 1,
      spans: [[15, Infinity]],
    });
    expect(unitMotion([{ frame: 0, callin: "Create" }], 1)).toBeNull();
    expect(unitMotion([{ frame: 15, callin: "StartMoving" }], 0)).toBeNull();
  });

  it("measures how far the unit has moved by a frame, counting only its moving frames", () => {
    expect(travelled(moving, 5)).toBe(0);
    expect(travelled(moving, 10)).toBe(0);
    expect(travelled(moving, 15)).toBe(10);
    expect(travelled(moving, 50)).toBe(60);
    expect(travelled(null, 50)).toBe(0);
  });

  it("carries smoke, a wake and a burst back along -Z by how far the unit moved since their birth", () => {
    const carried = [
      smoke({ birth: 20 }),
      wake([1, 0, 0], { birth: 20 }),
      puff({ kind: "burst", birth: 20 }),
    ];
    for (const emission of carried) {
      const still = particlesAt([emission], 25).sprites.centers;
      const moved = particlesAt([emission], 25, 1, moving).sprites.centers;
      expect(moved[0]).toBeCloseTo(still[0], 5);
      expect(moved[1]).toBeCloseTo(still[1], 5);
      expect(moved[2]).toBeCloseTo(still[2] - 10, 5);
    }
  });

  it("keeps 0.7 of the unit's speed in a VTOL heat cloud, as the engine does", () => {
    const emission = vtol([0, 0, 1], { birth: 20 });
    const still = particlesAt([emission], 25).sprites.centers[2];
    const moved = particlesAt([emission], 25, 1, moving).sprites.centers[2];
    // Five frames of travel at 2 elmos a frame back, and six updates at 0.7
    // of 2 elmos a frame forward (UnitScript.cpp:702-704).
    expect(moved).toBeCloseTo(still - 10 + 0.7 * 2 * 6, 5);
  });

  it("leaves a CEG puff, nano, a flame and a tracer where they are", () => {
    const fixed: Emission[] = [
      puff({ birth: 20 }),
      nano(20),
      {
        kind: "flame",
        birth: 20,
        at: [0, 0, 0],
        dir: [0, 0, 1],
        size: DEFAULT_FLAME_SIZE,
        seed: 1,
      },
      {
        kind: "tracer",
        birth: 20,
        at: [0, 0, 0],
        to: [0, 0, 100],
        seed: 2,
        weapon: 1,
      },
    ];
    const still = particlesAt(fixed, 25);
    const moved = particlesAt(fixed, 25, 1, moving);
    expect(Array.from(moved.centers)).toEqual(Array.from(still.centers));
    expect(Array.from(moved.sprites.centers)).toEqual(
      Array.from(still.sprites.centers),
    );
  });
});
