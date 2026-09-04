import { describe, expect, it } from "vitest";
import { clamp } from "./helpers";

describe("clamp", () => {
  it("passes a value already inside the range through unchanged", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("raises a value below lo up to lo", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("lowers a value above hi down to hi", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("passes a value on either boundary through unchanged", () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it("resolves a reversed lo/hi to hi, matching every copy it replaces", () => {
    expect(clamp(5, 10, 0)).toBe(0);
  });

  it("propagates NaN rather than clamping it to a boundary", () => {
    expect(clamp(Number.NaN, 0, 10)).toBeNaN();
  });
});
