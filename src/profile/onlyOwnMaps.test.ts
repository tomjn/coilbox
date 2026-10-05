import { describe, expect, it } from "vitest";
import { resolveOnlyOwnMaps } from "./onlyOwnMaps";

describe("resolveOnlyOwnMaps", () => {
  it("reads a missing key as none, which is every older profile", () => {
    expect(resolveOnlyOwnMaps(undefined)).toEqual({ status: "none" });
    expect(resolveOnlyOwnMaps(null)).toEqual({ status: "none" });
  });

  it("reads true as on and false as off", () => {
    expect(resolveOnlyOwnMaps(true)).toEqual({ status: "on" });
    expect(resolveOnlyOwnMaps(false)).toEqual({ status: "off" });
  });

  it("reports any other value as a problem that names what it was", () => {
    for (const [value, kind] of [
      ["true", "a string"],
      [1, "a number"],
      [{}, "an object"],
      [[], "a list"],
    ] as const) {
      const r = resolveOnlyOwnMaps(value);
      expect(r.status).toBe("problem");
      if (r.status === "problem") expect(r.issue).toContain(kind);
    }
  });
});
