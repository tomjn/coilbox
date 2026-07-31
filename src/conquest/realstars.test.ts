import { describe, expect, it } from "vitest";
import {
  generateGalaxy,
  JUMP_RANGE_LY,
  MAX_LANES_PER_SYSTEM,
} from "./generate";
import { NEUTRAL, posZ } from "./model";
import {
  DEFAULT_RADIUS_LY,
  RADIUS_CHOICES,
  STAR_SYSTEMS,
  systemCountWithin,
  systemsWithin,
} from "./realstars";

const named = (name: string) => STAR_SYSTEMS.find((s) => s.name === name);

describe("star catalogue", () => {
  it("puts Sol at the origin, first", () => {
    expect(STAR_SYSTEMS[0].name).toBe("Sol");
    expect(STAR_SYSTEMS[0].pos).toEqual([0, 0, 0]);
    expect(STAR_SYSTEMS[0].home).toBe(true);
  });

  it("orders systems by distance", () => {
    const distances = STAR_SYSTEMS.map((s) => s.distance);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it("agrees with the measured distances it was built from", () => {
    expect(named("Alpha Centauri")?.distance).toBeCloseTo(4.37, 1);
    expect(named("Barnard's Star")?.distance).toBeCloseTo(5.98, 1);
    expect(named("Sirius")?.distance).toBeCloseTo(8.58, 1);
    expect(named("Procyon")?.distance).toBeCloseTo(11.44, 1);
  });

  it("merges gravitationally bound partners into one system", () => {
    // Alpha Centauri A, B and Proxima are three nodes' worth of star packed
    // into 0.2 light years, which is why they collapse to one.
    expect(named("Alpha Centauri")?.components).toEqual([
      "G2.0 V",
      "K0 V",
      "M5.0 V",
    ]);
    expect(named("Sirius")?.components).toEqual(["A1.0 V", "DA2"]);
    expect(named("Luhman 16")?.components).toEqual(["L7.5", "T0.5"]);
  });

  it("includes the brown dwarfs discovered after the RECONS snapshot", () => {
    expect(named("Luhman 16")).toBeDefined();
    expect(named("WISE 0855-0714")).toBeDefined();
  });

  it("holds 15 objects in 10 systems within 10 light years", () => {
    const near = systemsWithin(10);
    expect(near).toHaveLength(10);
    expect(near.reduce((n, s) => n + s.components.length, 0)).toBe(15);
  });

  it("keeps every offered radius inside the playable size range", () => {
    for (const r of RADIUS_CHOICES) {
      const count = systemCountWithin(r);
      expect(count).toBeGreaterThanOrEqual(5);
      expect(count).toBeLessThanOrEqual(70);
    }
  });

  it("has a positional magnitude matching each stated distance", () => {
    for (const s of STAR_SYSTEMS) {
      expect(Math.hypot(...s.pos)).toBeCloseTo(s.distance, 2);
    }
  });

  it("spreads systems vertically rather than on a plane", () => {
    const flat = STAR_SYSTEMS.filter((s) => Math.abs(s.pos[2]) < 0.5);
    expect(flat.length).toBeLessThan(STAR_SYSTEMS.length / 2);
  });
});

const galaxy = (radiusLy = DEFAULT_RADIUS_LY) =>
  generateGalaxy({
    seed: 7,
    game: { shortname: "bar" },
    maps: [
      { name: "Map A", width: 10, height: 10 },
      { name: "Map B", width: 20, height: 20 },
    ],
    nodeCount: 0,
    factionCount: 2,
    layout: "realstars",
    radiusLy,
  });

describe("real-star galaxy generation", () => {
  it("takes its size from the radius, not the node-count knob", () => {
    expect(galaxy(10).nodes).toHaveLength(systemCountWithin(10));
    expect(galaxy(19).nodes).toHaveLength(systemCountWithin(19));
  });

  it("builds galaxies smaller than the procedural floor of eight", () => {
    expect(galaxy(8).nodes.length).toBeLessThan(8);
  });

  it("makes Sol the player capital", () => {
    const g = galaxy();
    const capital = g.nodes.find(
      (n) => n.kind === "capital" && n.owner === g.playerFactionId,
    );
    expect(capital?.name).toBe("Sol");
    expect(capital?.pos.slice(0, 2)).toEqual([0, 0]);
  });

  it("names nodes after the real stars", () => {
    const names = galaxy().nodes.map((n) => n.name);
    expect(names).toContain("Alpha Centauri");
    expect(names).toContain("Barnard's Star");
    expect(names).toContain("Sirius");
  });

  it("carries real spectral types onto the nodes", () => {
    const sirius = galaxy().nodes.find((n) => n.name === "Sirius");
    expect(sirius?.star?.spectral).toEqual(["A1.0 V", "DA2"]);
  });

  it("gives nodes a real vertical component", () => {
    const zs = galaxy().nodes.map((n) => posZ(n.pos));
    expect(zs.some((z) => Math.abs(z) > 1)).toBe(true);
  });

  it("only lays lanes between systems in jump range, bridging the rest", () => {
    const g = galaxy();
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const lengths = g.links.map(([a, b]) => {
      const p = byId.get(a)?.pos ?? [0, 0];
      const q = byId.get(b)?.pos ?? [0, 0];
      return Math.hypot(p[0] - q[0], p[1] - q[1], posZ(p) - posZ(q));
    });
    // Bridges added by the connectivity repair are the only lanes allowed to
    // exceed the range. If they were common, the range rule would not be the
    // thing shaping the map.
    const overRange = lengths.filter((d) => d > JUMP_RANGE_LY + 1e-6);
    expect(overRange.length).toBeLessThan(lengths.length * 0.1);
  });

  it("caps a system at four lanes", () => {
    // A crowded pocket would otherwise make one star an eight-lane hub, which
    // reads as noise and invents a chokepoint the strategy never intended.
    for (const radiusLy of RADIUS_CHOICES) {
      const g = generateGalaxy({
        seed: 5,
        game: { shortname: "bar" },
        maps: [{ name: "M", width: 10, height: 10 }],
        nodeCount: 0,
        factionCount: 2,
        layout: "realstars",
        radiusLy,
      });
      const degree = new Map<string, number>();
      for (const [a, b] of g.links) {
        degree.set(a, (degree.get(a) ?? 0) + 1);
        degree.set(b, (degree.get(b) ?? 0) + 1);
      }
      expect(Math.max(...degree.values())).toBeLessThanOrEqual(
        MAX_LANES_PER_SYSTEM,
      );
    }
  });

  it("leaves every system reachable", () => {
    const g = galaxy();
    const adj = new Map(g.nodes.map((n) => [n.id, [] as string[]]));
    for (const [a, b] of g.links) {
      adj.get(a)?.push(b);
      adj.get(b)?.push(a);
    }
    const seen = new Set([g.nodes[0].id]);
    const queue = [g.nodes[0].id];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === undefined) break;
      for (const n of adj.get(cur) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    expect(seen.size).toBe(g.nodes.length);
  });

  it("always leaves neutral territory to fight over", () => {
    // The full-frontier default hands every capital all its neighbours, which
    // in a small dense galaxy is the entire map. Real-star galaxies start lean
    // instead, so turn 1 is never a straight capital assault.
    for (const radiusLy of RADIUS_CHOICES) {
      const g = generateGalaxy({
        seed: 5,
        game: { shortname: "bar" },
        maps: [{ name: "M", width: 10, height: 10 }],
        nodeCount: 0,
        factionCount: 3,
        layout: "realstars",
        radiusLy,
      });
      const neutral = g.nodes.filter((n) => n.owner === NEUTRAL);
      expect(neutral.length).toBeGreaterThan(0);
    }
  });

  it("records the radius so the galaxy can be rerolled in place", () => {
    expect(galaxy(16).generated?.layout).toBe("realstars");
    expect(galaxy(16).generated?.radiusLy).toBe(16);
  });

  it("still varies factions and maps with the seed", () => {
    const a = galaxy();
    const b = generateGalaxy({
      seed: 99,
      game: { shortname: "bar" },
      maps: [
        { name: "Map A", width: 10, height: 10 },
        { name: "Map B", width: 20, height: 20 },
      ],
      nodeCount: 0,
      factionCount: 2,
      layout: "realstars",
      radiusLy: DEFAULT_RADIUS_LY,
    });
    // Same stars, different war.
    expect(b.nodes.map((n) => n.name)).toEqual(a.nodes.map((n) => n.name));
    expect(b.factions.map((f) => f.name)).not.toEqual(
      a.factions.map((f) => f.name),
    );
  });
});
