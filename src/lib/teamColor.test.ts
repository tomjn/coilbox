import { describe, expect, it } from "vitest";
import {
  isBlackHex,
  normalizeHex,
  pickTeamColorHex,
  randomTeamColorHex,
} from "./teamColor";

describe("normalizeHex", () => {
  it("lowercases and prefixes a bare 6-digit hex", () => {
    expect(normalizeHex("FF0000")).toBe("#ff0000");
    expect(normalizeHex("#AbCdEf")).toBe("#abcdef");
    expect(normalizeHex("#123456")).toBe("#123456");
  });

  it("rejects invalid input as null", () => {
    expect(normalizeHex(undefined)).toBeNull();
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex("#fff")).toBeNull(); // 3-digit shorthand unsupported
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("nothex")).toBeNull();
    expect(normalizeHex("#gggggg")).toBeNull();
  });
});

describe("isBlackHex", () => {
  it("treats every channel <= 0x18 as black", () => {
    expect(isBlackHex("#000000")).toBe(true);
    expect(isBlackHex("#181818")).toBe(true);
  });

  it("does not treat a saturated colour as black", () => {
    expect(isBlackHex("#ff0000")).toBe(false);
    expect(isBlackHex("#191919")).toBe(false); // 0x19 is over the threshold
  });
});

describe("randomTeamColorHex", () => {
  it("never returns black across many draws", () => {
    for (let i = 0; i < 100; i++) {
      const hex = randomTeamColorHex();
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(isBlackHex(hex)).toBe(false);
    }
  });
});

describe("pickTeamColorHex", () => {
  it("keeps a remembered colour when valid, non-black and free", () => {
    expect(pickTeamColorHex({ remembered: "#ff0000", used: [] })).toBe(
      "#ff0000",
    );
  });

  it("skips a remembered colour already used by others", () => {
    const picked = pickTeamColorHex({
      remembered: "#ff0000",
      used: ["#ff0000"],
    });
    expect(picked).not.toBe("#ff0000");
    expect(isBlackHex(picked)).toBe(false);
  });

  it("skips a remembered black colour", () => {
    const picked = pickTeamColorHex({ remembered: "#000000", used: [] });
    expect(isBlackHex(picked)).toBe(false);
  });

  it("normalizes the used set (case + missing '#') and drops black/invalid", () => {
    // "#FF0000" (upper), "ff0000" would collide with remembered #ff0000; black
    // and invalid entries are ignored rather than blocking anything.
    const picked = pickTeamColorHex({
      remembered: "#ff0000",
      used: ["FF0000", "#000000", "notacolor"],
    });
    expect(picked).not.toBe("#ff0000");
  });

  it("prefers the first free non-black palette entry when no remembered colour", () => {
    expect(
      pickTeamColorHex({ used: [], palette: ["#112233", "#445566"] }),
    ).toBe("#112233");
  });

  it("falls through the palette past taken entries", () => {
    expect(
      pickTeamColorHex({ used: ["#112233"], palette: ["#112233", "#445566"] }),
    ).toBe("#445566");
  });

  it("returns a non-colliding random colour when the whole palette is taken", () => {
    const palette = ["#112233", "#445566"];
    const picked = pickTeamColorHex({ used: palette, palette });
    expect(isBlackHex(picked)).toBe(false);
    expect(palette).not.toContain(picked);
  });

  it("never returns black across many random fallbacks", () => {
    for (let i = 0; i < 100; i++) {
      const picked = pickTeamColorHex({ used: ["#ff0000", "#00ff00"] });
      expect(picked).toMatch(/^#[0-9a-f]{6}$/);
      expect(isBlackHex(picked)).toBe(false);
    }
  });

  it("never returns a colour already in the used set", () => {
    const used = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"];
    for (let i = 0; i < 50; i++) {
      expect(used).not.toContain(pickTeamColorHex({ used }));
    }
  });
});
