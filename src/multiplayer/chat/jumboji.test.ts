import { describe, expect, it } from "vitest";
import { jumbojiCount } from "./jumboji";

describe("jumbojiCount", () => {
  it("counts a single emoji", () => {
    expect(jumbojiCount("😀")).toBe(1);
  });

  it("counts several emoji ignoring whitespace", () => {
    expect(jumbojiCount("😀 🎉 🚀")).toBe(3);
  });

  it("treats a multi-codepoint emoji as one", () => {
    expect(jumbojiCount("👍🏽")).toBe(1);
  });

  it("returns 0 when any non-emoji text is present", () => {
    expect(jumbojiCount("hi 😀")).toBe(0);
  });

  it("returns 0 for plain text", () => {
    expect(jumbojiCount("hello")).toBe(0);
  });

  it("returns 0 for an empty or blank message", () => {
    expect(jumbojiCount("   ")).toBe(0);
  });

  it("counts emoji across lines, newlines being whitespace", () => {
    // Deliberate: a coalesced block of emoji-only lines is still an emoji-only
    // message, and renders jumbo like any other. Pinned so it isn't "fixed".
    expect(jumbojiCount("😀\n🎉\n🚀")).toBe(3);
  });

  it("counts past the jumbo threshold so the caller can gate", () => {
    expect(jumbojiCount("😀😀😀😀")).toBe(4);
  });
});
