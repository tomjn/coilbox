import { describe, expect, it } from "vitest";
import { type Emission, particlesAt, unitFloat } from "./effects";

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
   *  gone once the frame reaches its death frame (`NanoProjectile.cpp:71-77`). */
  it("lives len / 3 frames for a builder, starting where it was emitted", () => {
    const emissions = [nano(10)];
    expect(particlesAt(emissions, 9).count).toBe(0);
    const born = particlesAt(emissions, 10);
    expect(born.count).toBe(1);
    expect(Array.from(born.centers)).toEqual([0, 0, 0]);
    expect(particlesAt(emissions, 19).count).toBe(1);
    expect(particlesAt(emissions, 20).count).toBe(0);
  });

  it("moves a builder's particle three elmos a frame, give or take its jitter", () => {
    const later = particlesAt([nano(0)], 5);
    const x = later.centers[0];
    expect(x).toBeGreaterThan(15 * 0.8);
    expect(x).toBeLessThan(15 * 1.2);
  });

  /** A factory's lives `int(len)` frames at 1 elmo a frame (`:703`). */
  it("lives len frames for a factory", () => {
    const emissions = [nano(0, { style: "factory" })];
    expect(particlesAt(emissions, 29).count).toBe(1);
    expect(particlesAt(emissions, 30).count).toBe(0);
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
});
