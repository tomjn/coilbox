import { describe, expect, it } from "vitest";
import {
  type ContentRequirement,
  computeMissingRequirements,
  dedupeRequirements,
  engineVersionRequirement,
  exactGameRequirement,
  exactMapRequirement,
  type InstalledContentSnapshot,
} from "./resolveContent";

const installed = (
  over: Partial<InstalledContentSnapshot> = {},
): InstalledContentSnapshot => ({
  games: [{ name: "Beyond All Reason", shortname: "bar", version: "1.0" }],
  maps: ["Comet Catcher Redux"],
  engineVersions: ["105.1.1-2200-abcdef BAR"],
  ...over,
});

describe("dedupeRequirements", () => {
  it("keeps the first occurrence of each kind+label pair", () => {
    const reqs = [
      exactGameRequirement("BAR"),
      exactMapRequirement("Map A"),
      exactGameRequirement("BAR"),
      exactMapRequirement("Map A"),
      exactMapRequirement("Map B"),
    ];
    expect(dedupeRequirements(reqs).map((r) => `${r.kind}:${r.label}`)).toEqual(
      ["game:BAR", "map:Map A", "map:Map B"],
    );
  });
});

describe("computeMissingRequirements", () => {
  it("reports nothing missing when every requirement is installed", () => {
    const reqs = [
      exactGameRequirement("Beyond All Reason"),
      exactMapRequirement("Comet Catcher Redux"),
    ];
    expect(computeMissingRequirements(reqs, installed())).toEqual([]);
  });

  it("reports a missing game", () => {
    const reqs = [exactGameRequirement("Zero-K")];
    const missing = computeMissingRequirements(reqs, installed());
    expect(missing.map((r) => r.label)).toEqual(["Zero-K"]);
  });

  it("reports a missing map", () => {
    const reqs = [exactMapRequirement("Some Other Map")];
    const missing = computeMissingRequirements(reqs, installed());
    expect(missing.map((r) => r.label)).toEqual(["Some Other Map"]);
  });

  it("reports a missing engine version", () => {
    const reqs = [engineVersionRequirement("999.0.0")];
    const missing = computeMissingRequirements(reqs, installed());
    expect(missing.map((r) => r.label)).toEqual(["999.0.0"]);
  });

  it("dedupes before diffing, so a repeated requirement is reported once", () => {
    const reqs = [
      exactGameRequirement("Zero-K"),
      exactGameRequirement("Zero-K"),
    ];
    expect(computeMissingRequirements(reqs, installed())).toHaveLength(1);
  });

  it("mixes satisfied and missing requirements independently", () => {
    const reqs: ContentRequirement[] = [
      exactGameRequirement("Beyond All Reason"),
      exactMapRequirement("Missing Map"),
      engineVersionRequirement("999.0.0"),
    ];
    const missing = computeMissingRequirements(reqs, installed());
    expect(missing.map((r) => r.kind)).toEqual(["map", "engine"]);
  });

  it("supports a custom isInstalled predicate (shortname-based game match)", () => {
    const req: ContentRequirement = {
      kind: "game",
      label: "BAR",
      downloadKey: "bar",
      isInstalled: (i) =>
        i.games.some((g) => (g.shortname ?? "").toLowerCase() === "bar"),
    };
    expect(computeMissingRequirements([req], installed())).toEqual([]);
    expect(computeMissingRequirements([req], installed({ games: [] }))).toEqual(
      [req],
    );
  });
});
