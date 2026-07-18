import { describe, expect, it } from "vitest";
import { type ExoticClass, exoticClassFor, nodeBodyLabel } from "./GalaxyView";

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
