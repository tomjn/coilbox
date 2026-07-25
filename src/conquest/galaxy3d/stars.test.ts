import { describe, expect, it } from "vitest";
import {
  type ExoticClass,
  exoticClassFor,
  nodeBodyLabel,
  starSystemFor,
  starSystemLabel,
  starTypeForSpectral,
} from "./GalaxyView";

/** First id (scanning `prefix-N`) whose exotic class matches `want`. */
function idOfExotic(want: ExoticClass): string {
  for (let i = 0; i < 100000; i++) {
    if (exoticClassFor(`x-${i}`) === want) return `x-${i}`;
  }
  throw new Error(`no id produced ${want}`);
}

describe("exoticClassFor", () => {
  it("is deterministic per node id", () => {
    expect(exoticClassFor("node-7")).toBe(exoticClassFor("node-7"));
  });

  it("keeps exotics a sparse minority with every class represented", () => {
    const classes = Array.from({ length: 2000 }, (_, i) =>
      exoticClassFor(`n-${i}`),
    );
    const ordinary = classes.filter((c) => c === undefined).length;
    const exotic = classes.length - ordinary;
    // Overwhelmingly ordinary stars.
    expect(ordinary).toBeGreaterThan(classes.length * 0.85);
    // But a handful of each exotic kind shows up.
    for (const kind of ["pulsar", "variable", "gasgiant", "carbon"] as const) {
      expect(classes.filter((c) => c === kind).length).toBeGreaterThan(0);
    }
    expect(exotic).toBeGreaterThan(0);
  });
});

describe("nodeBodyLabel", () => {
  it("names an exotic non-capital node by its exotic class", () => {
    expect(nodeBodyLabel(idOfExotic("pulsar"), false, undefined)).toBe(
      "pulsar",
    );
    expect(nodeBodyLabel(idOfExotic("gasgiant"), false, undefined)).toBe(
      "ringed gas giant",
    );
  });

  it("never treats a capital as exotic (endpoints read as giants)", () => {
    const id = idOfExotic("pulsar");
    // As a capital the same id is a stellar system, not a pulsar.
    expect(nodeBodyLabel(id, true, undefined)).not.toBe("pulsar");
  });

  it("labels void bodies regardless of any exotic roll", () => {
    expect(nodeBodyLabel(idOfExotic("carbon"), false, "comet")).toBe("comet");
  });
});

describe("starTypeForSpectral", () => {
  it("maps real classes onto the star types", () => {
    expect(starTypeForSpectral("A1.0 V").name).toBe("white star");
    expect(starTypeForSpectral("G2.0 V").name).toBe("yellow star");
    expect(starTypeForSpectral("K0 V").name).toBe("orange dwarf");
    expect(starTypeForSpectral("M5.5 V").name).toBe("red dwarf");
    expect(starTypeForSpectral("F5 IV-V").name).toBe("white star");
  });

  it("reads white dwarfs off their D prefix", () => {
    expect(starTypeForSpectral("DA2").name).toBe("white dwarf");
    expect(starTypeForSpectral("DQZ").name).toBe("white dwarf");
  });

  it("gives the substellar classes a brown dwarf", () => {
    for (const s of ["L7.5", "T0.5", "Y4"]) {
      expect(starTypeForSpectral(s).name).toBe("brown dwarf");
    }
  });

  it("promotes bright luminosity classes to giants", () => {
    expect(starTypeForSpectral("M2 III").name).toBe("red giant");
    expect(starTypeForSpectral("B8 II").name).toBe("blue giant");
  });

  it("falls back rather than throwing on anything unrecognised", () => {
    expect(starTypeForSpectral("").name).toBe("yellow star");
    expect(starTypeForSpectral("???").name).toBe("yellow star");
  });
});

describe("real stellar systems", () => {
  const star = (spectral: string[]) => ({ spectral });

  it("takes its components from the catalogue, not the binary roll", () => {
    const sirius = starSystemFor("any-id", false, star(["A1.0 V", "DA2"]));
    expect(sirius.primary.name).toBe("white star");
    expect(sirius.companion?.name).toBe("white dwarf");
  });

  it("names a trinary as a triple system", () => {
    const alphaCen = starSystemFor("n", false, star(["G2.0 V", "K0 V", "M5.0 V"]));
    expect(alphaCen.members).toHaveLength(3);
    expect(starSystemLabel(alphaCen)).toBe(
      "triple system, yellow star + orange dwarf + red dwarf",
    );
  });

  it("never labels a real star as an exotic phenomenon", () => {
    // There is no pulsar within 19 light years, so a node with real spectral
    // data must never roll one however its id hashes.
    const pulsarId = idOfExotic("pulsar");
    expect(nodeBodyLabel(pulsarId, false, undefined)).toBe("pulsar");
    expect(nodeBodyLabel(pulsarId, false, undefined, star(["M3.5 V"]))).toBe(
      "red dwarf",
    );
  });
});
