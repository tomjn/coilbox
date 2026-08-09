import { describe, expect, it } from "vitest";
import { isRealEngineVersion } from "./engineVersion";

describe("isRealEngineVersion", () => {
  it("accepts a real version string", () => {
    expect(isRealEngineVersion("105.1.1-2554-gabcdef")).toBe(true);
  });

  it("rejects undefined", () => {
    expect(isRealEngineVersion(undefined)).toBe(false);
  });

  it("rejects an empty or blank string", () => {
    expect(isRealEngineVersion("")).toBe(false);
    expect(isRealEngineVersion("   ")).toBe(false);
  });

  it("rejects a dot-prefixed path fragment such as the legacy .spring", () => {
    expect(isRealEngineVersion(".spring")).toBe(false);
  });
});
