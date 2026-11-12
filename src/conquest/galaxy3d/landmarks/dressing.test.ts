import { describe, expect, it } from "vitest";
import { NEUTRAL } from "../../model";
import { conquestDressing } from "./dressing";
import { ANOMALY_KINDS } from "./kinds";

const galaxy = (id: string, capitals: string[], ordinary = 24) => ({
  id,
  nodes: [
    ...capitals.map((owner, k) => ({
      id: `cap${k}`,
      kind: "capital" as const,
      owner,
    })),
    ...Array.from({ length: ordinary }, (_, k) => ({
      id: `n${k}`,
      owner: k % 2 ? "a" : NEUTRAL,
    })),
  ],
});
type Doc = Parameters<typeof conquestDressing>[0];
const deal = (
  id: string,
  capitals: string[],
  planet?: Parameters<typeof conquestDressing>[1],
  ordinary?: number,
) => conquestDressing(galaxy(id, capitals, ordinary) as unknown as Doc, planet);

describe("conquestDressing", () => {
  it("deals three capitals a stronghold, a spire and a landing pad", () => {
    const d = deal("one", ["a", "b", "c"]);
    const forms = [0, 1, 2].map((k) => d.get(`cap${k}`)?.landmark);
    expect(forms.map(String).sort()).toEqual(["landing", "spire", "undefined"]);
  });

  it("deals two capitals two different forms", () => {
    for (const id of ["one", "two", "three", "four"]) {
      const d = deal(id, ["a", "b"]);
      expect(d.get("cap0")?.landmark).not.toBe(d.get("cap1")?.landmark);
    }
  });

  it("gives a capital nobody holds nothing", () => {
    expect(deal("one", [NEUTRAL, "a"]).has("cap0")).toBe(false);
  });

  it("deals the same map the same way, and another map another", () => {
    const list = (id: string) => JSON.stringify([...deal(id, ["a", "b", "c"])]);
    expect(list("one")).toBe(list("one"));
    expect(new Set(["one", "two", "three"].map(list)).size).toBeGreaterThan(1);
  });

  it("makes a few ordinary locations an anomaly, each kind once", () => {
    const kinds = [...deal("one", ["a", "b"]).entries()]
      .filter(([id, v]) => id.startsWith("n") && v.landmark !== "depot")
      .map(([, v]) => v.landmark);
    expect(kinds).toHaveLength(3);
    expect(new Set(kinds).size).toBe(3);
    for (const k of kinds) expect(ANOMALY_KINDS).toContain(k);
    // A big map runs out of kinds before it runs out of locations.
    const many = [...deal("one", [], undefined, 200).values()].filter(
      (v) => v.landmark !== "depot",
    );
    expect(many).toHaveLength(ANOMALY_KINDS.length);
  });

  it("deals a moon no ruin", () => {
    const kinds = [...deal("one", [], "moon", 200).values()]
      .map((v) => v.landmark)
      .filter((k) => k !== "depot");
    expect(kinds).toHaveLength(ANOMALY_KINDS.length - 1);
    expect(kinds).not.toContain("ruin");
  });

  it("makes some of the rest depots, on every planet", () => {
    const depots = (planet?: Parameters<typeof conquestDressing>[1]) =>
      [...deal("one", ["a", "b"], planet).values()].filter(
        (v) => v.landmark === "depot",
      );
    // 24 ordinary locations less 3 anomalies leaves 21, and a fifth of that is 4.
    expect(depots("temperate")).toHaveLength(4);
    expect(depots()).toHaveLength(4);
    expect(depots("moon")).toHaveLength(4);
  });
});
