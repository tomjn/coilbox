import { describe, expect, it } from "vitest";
import {
  isBlackHex,
  normalizeHex,
  pickTeamColorHex,
  randomTeamColorHex,
  readableTeamTextColor,
} from "./teamColor";

/** Independent re-implementation of WCAG contrast, so the test does not just
 * re-run the production formula against itself. */
function channelsOf(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
function luminance(hex: string): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = channelsOf(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Hue only, 0..360, matching the standard RGB->HSL conversion. */
function hueOf(hex: string): number {
  const [r, g, b] = channelsOf(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return h * 60;
}
/** Same HSL->hex formula the production background constant is built from,
 * so the test's background matches `readableTeamTextColor`'s exactly rather
 * than an eyeballed guess. */
function hslToHexForTest(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const rgb =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return `#${rgb
    .map((v) =>
      Math.round((v + m) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
const DARK_BG = hslToHexForTest(240, 0.06, 0.07);
const LIGHT_BG = "#ffffff";
/** Same formula as `THEME_CARD_HEX`'s dark entry: a touch lighter than
 * `DARK_BG`, matching picoframe's `--card` in dark mode. */
const DARK_CARD_BG = hslToHexForTest(240, 0.05, 0.1);

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

describe("readableTeamTextColor", () => {
  it("lightens a dark navy on the dark theme until it clears 4.5:1", () => {
    const adjusted = readableTeamTextColor("#001030", "dark");
    expect(contrast(adjusted, DARK_BG)).toBeGreaterThanOrEqual(4.5);
    expect(hueOf(adjusted)).toBeCloseTo(hueOf("#001030"), 0);
  });

  it("darkens a pale yellow on the light theme until it clears 4.5:1", () => {
    const adjusted = readableTeamTextColor("#ffffcc", "light");
    expect(contrast(adjusted, LIGHT_BG)).toBeGreaterThanOrEqual(4.5);
    expect(hueOf(adjusted)).toBeCloseTo(hueOf("#ffffcc"), 0);
  });

  it("leaves a colour unchanged when it already clears the bar", () => {
    // A saturated orange already reads at 4.5:1+ against the dark background.
    const readable = "#ffa500";
    expect(contrast(readable, DARK_BG)).toBeGreaterThanOrEqual(4.5);
    expect(readableTeamTextColor(readable, "dark")).toBe(readable);
  });

  it("preserves hue for a mid-tone colour that fails on both themes", () => {
    const midBlue = "#3050a0";
    const onDark = readableTeamTextColor(midBlue, "dark");
    const onLight = readableTeamTextColor(midBlue, "light");
    expect(contrast(onDark, DARK_BG)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(onLight, LIGHT_BG)).toBeGreaterThanOrEqual(4.5);
    expect(hueOf(onDark)).toBeCloseTo(hueOf(midBlue), 0);
    expect(hueOf(onLight)).toBeCloseTo(hueOf(midBlue), 0);
  });

  it("passes through invalid input unchanged", () => {
    expect(readableTeamTextColor("notacolor", "dark")).toBe("notacolor");
  });

  it("lightens a dark navy on the dark card surface until it clears 4.5:1", () => {
    const adjusted = readableTeamTextColor("#001030", "dark", "card");
    expect(contrast(adjusted, DARK_CARD_BG)).toBeGreaterThanOrEqual(4.5);
    expect(hueOf(adjusted)).toBeCloseTo(hueOf("#001030"), 0);
  });

  it("needs more lightening for the card surface than the page background", () => {
    // The card is lighter than the page in dark mode, so a colour adjusted
    // against the page background alone can still fall short on the card.
    const onBackground = readableTeamTextColor("#001030", "dark");
    expect(contrast(onBackground, DARK_CARD_BG)).toBeLessThan(4.5);
    const onCard = readableTeamTextColor("#001030", "dark", "card");
    expect(contrast(onCard, DARK_CARD_BG)).toBeGreaterThanOrEqual(4.5);
  });

  it("defaults to the page background when no surface is given", () => {
    expect(readableTeamTextColor("#001030", "dark")).toBe(
      readableTeamTextColor("#001030", "dark", "background"),
    );
  });
});
