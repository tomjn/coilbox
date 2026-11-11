import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "../content/bindings";
import sf from "../content/fixtures/splinter-faction-unit-dataset.json";
import { generateRun } from "./generate";
import { buildGraphFor } from "./unitLimit";

const SF = (sf as { units: UnitDatasetEntry[] }).units;

/** A unit for a hand-made tree. */
function u(
  name: string,
  opts: {
    builds?: string[];
    mobile?: boolean;
    stats?: Record<string, unknown>;
    minWaterDepth?: number;
  } = {},
): UnitDatasetEntry {
  return {
    name,
    mobile: opts.mobile ?? false,
    buildOptions: opts.builds,
    minWaterDepth: opts.minWaterDepth,
    stats: {
      metalCost: 100,
      ...(opts.builds ? { builder: true } : {}),
      ...opts.stats,
    },
  } as UnitDatasetEntry;
}

const GUN = { weapons: [{ name: "gun" }] };

function startOf(units: UnitDatasetEntry[], start: string) {
  const build = buildGraphFor(start, units);
  if (!build) throw new Error("no build graph");
  const run = generateRun({
    seed: 855435105,
    length: "standard",
    difficulty: 1,
    game: { shortname: "T", pinnedName: "T 1" },
    factionId: "player",
    skin: "galaxy",
    maps: [{ name: "m", size: 1 }],
    build,
  });
  return { run, unlocked: new Set(run.progress.unlockedUnits) };
}

describe("a warpath's starting build list on Splinter Faction", () => {
  const by = new Map(SF.map((x) => [x.name.toLowerCase(), x]));
  const armed = (n: string) =>
    ((by.get(n)?.stats?.weapons as unknown[]) ?? []).length > 0;

  for (const start of ["fedcommander", "lozcommander"]) {
    it(`gives ${start} factories that each build an armed unit and a builder`, () => {
      const { unlocked } = startOf(SF, start);
      const factories = [...unlocked].filter(
        (n) => !by.get(n)?.mobile && (by.get(n)?.buildOptions?.length ?? 0),
      );
      expect(factories.length).toBeGreaterThan(0);
      for (const f of factories) {
        const options = by.get(f)?.buildOptions ?? [];
        const units = options.filter((o) => unlocked.has(o.toLowerCase()));
        expect(
          units.some((o) => armed(o.toLowerCase())),
          f,
        ).toBe(true);
        // A factory that builds no builder, as SF's sea plants, needs none.
        const isBuilder = (o: string) =>
          by.get(o.toLowerCase())?.stats?.builder === true;
        expect(units.some(isBuilder), f).toBe(options.some(isBuilder));
      }
    });

    it(`gives ${start} a land factory, a sea factory, energy, metal and a defence`, () => {
      const { unlocked } = startOf(SF, start);
      const has = (pred: (x: UnitDatasetEntry) => boolean) =>
        [...unlocked].some((n) => {
          const x = by.get(n);
          return !!x && !x.mobile && pred(x);
        });
      const seaFactory = (x: UnitDatasetEntry) =>
        (x.minWaterDepth ?? 0) > 0 && (x.buildOptions?.length ?? 0) > 0;
      expect(has(seaFactory)).toBe(true);
      expect(
        has((x) => !seaFactory(x) && (x.buildOptions?.length ?? 0) > 0),
      ).toBe(true);
      expect(has((x) => ((x.stats?.energyMake as number) ?? 0) > 0)).toBe(true);
      expect(has((x) => ((x.stats?.makesMetal as number) ?? 0) > 0)).toBe(true);
      expect(has((x) => armed(x.name.toLowerCase()))).toBe(true);
    });
  }
});

describe("the role rules", () => {
  const tree = [
    u("com", {
      mobile: true,
      builds: [
        "airplant",
        "lab",
        "yard",
        "solar",
        "geo",
        "mex",
        "radar",
        "llt",
        "teeth",
      ],
    }),
    u("airplant", { builds: ["plane"], stats: { metalCost: 50 } }),
    u("plane", { mobile: true, stats: { canFly: true, ...GUN } }),
    u("lab", { builds: ["tank", "scout", "con"], stats: { metalCost: 90 } }),
    u("tank", { mobile: true, stats: { metalCost: 150, ...GUN } }),
    u("scout", { mobile: true, stats: { metalCost: 30, ...GUN } }),
    u("con", { mobile: true, builds: ["solar", "lab2"] }),
    u("lab2", { builds: ["con2", "heavy"], stats: { metalCost: 900 } }),
    u("heavy", { mobile: true, stats: GUN }),
    u("con2", {
      mobile: true,
      builds: ["solar", "fusion", "moho", "bigradar"],
    }),
    u("fusion", { stats: { energyMake: 1000 } }),
    u("moho", { stats: { extractsMetal: 0.004 } }),
    u("bigradar", { stats: { radarDistance: 4000 } }),
    u("yard", { builds: ["boat"], minWaterDepth: 20 }),
    u("boat", { mobile: true, stats: GUN }),
    u("solar", { stats: { energyMake: 20, metalCost: 150 } }),
    u("geo", { stats: { energyMake: 300, metalCost: 10, needGeo: true } }),
    u("mex", { stats: { extractsMetal: 0.001 } }),
    u("radar", { stats: { radarDistance: 2000 } }),
    u("llt", { stats: GUN }),
    u("teeth", { stats: { isFeature: true, metalCost: 5 } }),
  ];

  it("starts with one of each kind and passes over geothermal and air plants", () => {
    const { unlocked } = startOf(tree, "com");
    for (const n of [
      "lab",
      "yard",
      "solar",
      "mex",
      "radar",
      "llt",
      "teeth",
      "scout",
      "con",
      "boat",
    ]) {
      expect(unlocked.has(n), n).toBe(true);
    }
    for (const n of ["geo", "airplant", "plane", "lab2", "tank"]) {
      expect(unlocked.has(n), n).toBe(false);
    }
  });

  it("reads Zero-K's income and passes over a plate for its factory", () => {
    const zk = [
      u("com", {
        mobile: true,
        builds: ["plate", "fac", "solar", "mex", "radar", "llt"],
      }),
      u("plate", { builds: ["con", "raider"], stats: { metalCost: 150 } }),
      u("fac", { builds: ["con", "raider"], stats: { metalCost: 700 } }),
      u("con", {
        mobile: true,
        builds: ["solar", "mex"],
        stats: { incomeEnergy: 1, incomeMetal: 1, ...GUN },
      }),
      u("raider", { mobile: true, stats: GUN }),
      u("solar", { stats: { energyMake: 0, incomeEnergy: 2, metalCost: 70 } }),
      u("mex", { stats: { metalExtractorMult: 1, metalCost: 85 } }),
      u("radar", { stats: { radarDistance: 2100 } }),
      u("llt", { stats: GUN }),
    ];
    const { unlocked, run } = startOf(zk, "com");
    for (const n of ["fac", "solar", "mex", "radar", "llt", "raider", "con"]) {
      expect(unlocked.has(n), n).toBe(true);
    }
    expect(unlocked.has("plate")).toBe(false);
    const plate = run.nodes
      .flatMap((n) => n.reward?.options ?? [])
      .find((o) => o.kind === "unlock" && o.unit === "plate");
    if (plate?.kind === "unlock") expect(plate.opens).toContain("fac");
  });

  it("brings a second tier builder's own buildings with an unlock of its factory", () => {
    const { run } = startOf(tree, "com");
    const offers = run.nodes.flatMap((n) => [
      ...(n.reward?.options ?? []),
      ...(n.shop?.offers.map((o) => o.option) ?? []),
    ]);
    const lab2 = offers.find((o) => o.kind === "unlock" && o.unit === "lab2");
    if (!lab2 || lab2.kind !== "unlock") {
      throw new Error("no offer of lab2 in this seed");
    }
    expect(lab2.opens).toEqual(
      expect.arrayContaining(["con2", "heavy", "fusion", "moho", "bigradar"]),
    );
  });
});
