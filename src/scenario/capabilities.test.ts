import { describe, expect, it } from "vitest";
import type { RuntimeMarker } from "./bindings";
import { runtimeCapabilities, supportedCount } from "./capabilities";

const marker = (
  version: number,
  conditions: string[],
  actions: string[],
): RuntimeMarker => ({ version, schemaVersion: 1, conditions, actions });

describe("runtimeCapabilities", () => {
  it("calls a type both runtimes declare supported", () => {
    const caps = runtimeCapabilities(
      marker(1, ["var"], ["victory"]),
      marker(1, ["var"], ["victory"]),
    );
    expect(caps.conditions).toEqual([{ name: "var", status: "supported" }]);
    expect(caps.actions).toEqual([{ name: "victory", status: "supported" }]);
  });

  it("marks a type only coilbox has as one an update would add", () => {
    const caps = runtimeCapabilities(
      marker(1, ["var"], []),
      marker(2, ["var", "zone_held_for"], ["dialogue"]),
    );
    expect(caps.conditions).toEqual([
      { name: "var", status: "supported" },
      { name: "zone_held_for", status: "added" },
    ]);
    expect(caps.actions).toEqual([{ name: "dialogue", status: "added" }]);
  });

  it("marks a type only the game has as extra", () => {
    const caps = runtimeCapabilities(
      marker(3, ["var", "weather"], []),
      marker(2, ["var"], []),
    );
    expect(caps.conditions).toEqual([
      { name: "var", status: "supported" },
      { name: "weather", status: "extra" },
    ]);
  });

  it("handles a game that is both behind and ahead at once", () => {
    const caps = runtimeCapabilities(
      marker(2, ["var", "weather"], []),
      marker(2, ["var", "zone_held_for"], []),
    );
    expect(caps.conditions).toEqual([
      { name: "var", status: "supported" },
      { name: "weather", status: "extra" },
      { name: "zone_held_for", status: "added" },
    ]);
  });

  it("reports what installing would add when the game has no runtime", () => {
    const caps = runtimeCapabilities(null, marker(1, ["var"], ["victory"]));
    expect(caps.conditions).toEqual([{ name: "var", status: "added" }]);
    expect(caps.actions).toEqual([{ name: "victory", status: "added" }]);
  });

  it("does not call installed types extra when coilbox ships no runtime", () => {
    const caps = runtimeCapabilities(marker(1, ["var"], ["victory"]), null);
    expect(caps.conditions).toEqual([{ name: "var", status: "supported" }]);
    expect(caps.actions).toEqual([{ name: "victory", status: "supported" }]);
  });

  it("has nothing to list when neither marker can be read", () => {
    expect(runtimeCapabilities(null, null)).toEqual({
      conditions: [],
      actions: [],
    });
  });

  it("lists a duplicated declaration once", () => {
    const caps = runtimeCapabilities(
      marker(1, ["var", "var"], []),
      marker(1, ["var"], []),
    );
    expect(caps.conditions).toEqual([{ name: "var", status: "supported" }]);
  });
});

describe("supportedCount", () => {
  it("counts only what the installed runtime implements", () => {
    const caps = runtimeCapabilities(
      marker(1, ["var", "weather"], []),
      marker(2, ["var", "zone_held_for"], []),
    );
    expect(supportedCount(caps.conditions)).toBe(2);
    expect(caps.conditions).toHaveLength(3);
  });
});
