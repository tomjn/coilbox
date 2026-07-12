import { describe, expect, it } from "vitest";
import { matchesHighlight } from "./highlight";

describe("matchesHighlight", () => {
  it("matches a configured word as a whole word", () => {
    expect(matchesHighlight("watch the metal", ["metal"], null, false)).toBe(
      true,
    );
  });

  it("is case-insensitive", () => {
    expect(matchesHighlight("METAL spot here", ["metal"], null, false)).toBe(
      true,
    );
    expect(matchesHighlight("watch the metal", ["METAL"], null, false)).toBe(
      true,
    );
  });

  it("does not match a substring inside another word", () => {
    expect(matchesHighlight("that was malice", ["alice"], null, false)).toBe(
      false,
    );
  });

  it("matches own username only when enabled", () => {
    expect(matchesHighlight("hi alice!", [], "alice", true)).toBe(true);
    expect(matchesHighlight("hi alice!", [], "alice", false)).toBe(false);
  });

  it("returns false with no words and own-username disabled", () => {
    expect(matchesHighlight("hello there", [], "alice", false)).toBe(false);
  });

  it("ignores empty / whitespace words", () => {
    expect(matchesHighlight("hello there", ["", "  "], null, false)).toBe(
      false,
    );
  });

  it("matches when any of several words is present", () => {
    expect(
      matchesHighlight("air raid incoming", ["metal", "air"], null, false),
    ).toBe(true);
  });

  it("ignores a blank own username even when enabled", () => {
    expect(matchesHighlight("hello there", [], "   ", true)).toBe(false);
  });
});
