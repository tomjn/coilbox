import { describe, expect, it } from "vitest";
import {
  type Emission,
  NANO_DOTS_PER_FRAME,
  NANO_SPREAD,
  type Particles,
  particlesAt,
  unitFloat,
} from "./effects";

function nano(birth: number, overrides: Partial<Emission> = {}): Emission {
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
  emission: Emission,
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
