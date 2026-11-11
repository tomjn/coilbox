import { describe, expect, it } from "vitest";
import { ANOMALY_REACH, buildAnomaly, type StandingAnomaly } from "./anomalies";
import { ANOMALY_KINDS } from "./kinds";
import { ANOMALY_PALETTES } from "./palettes";
import { RUIN_REACH } from "./ruin";

const flat = () => 0;
const KINDS = ANOMALY_KINDS.filter((k): k is StandingAnomaly => k !== "ruin");
const build = (kind: StandingAnomaly, seed: number) =>
  buildAnomaly(kind, flat, ANOMALY_PALETTES.temperate, seed).built;
const positions = (kind: StandingAnomaly, seed: number) =>
  Array.from(build(kind, seed).solid.getAttribute("position").array);

describe.each(KINDS)("buildAnomaly %s", (kind) => {
  it.each([1, 2, 3])("stands whole and in the ground for seed %i", (seed) => {
    const built = build(kind, seed);
    expect(built.glow).toBeNull();
    for (const v of built.solid.getAttribute("position").array)
      expect(Number.isFinite(v)).toBe(true);
    const tower = built.bounds("tower");
    if (!tower) throw new Error("no tower");
    // It goes down into the ground and stands well above it.
    expect(tower.min.y).toBeLessThan(0);
    expect(tower.max.y).toBeGreaterThan(1.5);
    expect(tower.max.y).toBeLessThan(4);
  });

  it("keeps its heaped ground inside its reach", () => {
    expect(ANOMALY_REACH).toBeLessThan(RUIN_REACH);
    const pos = build(kind, 1).soft?.getAttribute("position");
    expect(pos).toBeDefined();
    if (!pos) return;
    let far = 0;
    for (let i = 0; i < pos.count; i++)
      far = Math.max(far, Math.hypot(pos.getX(i), pos.getZ(i)));
    expect(far).toBeLessThanOrEqual(ANOMALY_REACH + 1e-6);
  });

  it("is the same for one seed and differs for another", () => {
    const a = positions(kind, 5);
    expect(positions(kind, 5)).toEqual(a);
    expect(positions(kind, 6)).not.toEqual(a);
  });
});
