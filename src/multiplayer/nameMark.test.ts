import { describe, expect, it } from "vitest";
import { NAME_MARK_CLASS, type NameMark, nameMarkFor } from "./nameMark";

describe("nameMarkFor", () => {
  const source = { me: "alice", friends: ["bob", "dave"], party: ["carol"] };

  it("marks the player's own name", () => {
    expect(nameMarkFor("alice", source)).toBe("you");
  });

  it("marks a friend and a party member", () => {
    expect(nameMarkFor("bob", source)).toBe("friend");
    expect(nameMarkFor("carol", source)).toBe("party");
  });

  it("leaves a stranger unmarked", () => {
    expect(nameMarkFor("mallory", source)).toBeNull();
  });

  it("puts you before friend, and friend before party", () => {
    const all = {
      me: "alice",
      friends: ["alice", "bob"],
      party: ["alice", "bob"],
    };
    expect(nameMarkFor("alice", all)).toBe("you");
    expect(nameMarkFor("bob", all)).toBe("friend");
  });

  it("marks only the player's own name on a server with no friends or parties", () => {
    const bare = { me: "alice", friends: [], party: [] };
    expect(nameMarkFor("alice", bare)).toBe("you");
    expect(nameMarkFor("bob", bare)).toBeNull();
  });

  it("marks nobody as you before login", () => {
    expect(nameMarkFor("", { me: null, friends: [], party: [] })).toBeNull();
  });
});

/**
 * The legibility of the three mark colours, measured the way
 * `theme/mutedForeground.test.ts` measures secondary text, and with the same
 * transcribed maths and base presets for the reason that file gives.
 */

type Rgb = [number, number, number];

/** CSS `hsl()` to sRGB channels, all 0 to 1 except the hue. */
function hsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * Math.min(Math.max(s, 0), 1);
  const sector = ((((h % 360) + 360) % 360) / 60) % 6;
  const x = c * (1 - Math.abs((sector % 2) - 1));
  const rgb: Rgb =
    sector < 1
      ? [c, x, 0]
      : sector < 2
        ? [x, c, 0]
        : sector < 3
          ? [0, c, x]
          : sector < 4
            ? [0, x, c]
            : sector < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return rgb.map((v) => v + m) as Rgb;
}

function hex(value: string): Rgb {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map(
    (c) => c / 255,
  ) as Rgb;
}

/** WCAG 2.2 relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.2 contrast ratio between two colours. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every base preset, as `[name, --base-hue, --base-sat]`, transcribed from
 * `@picoframe/frame/src/theme.css`. */
const BASES: [string, number, number][] = [
  ["zinc", 240, 1],
  ["slate", 215, 1.6],
  ["gray", 220, 0.5],
  ["stone", 30, 1.5],
  ["neutral", 0, 0],
  ["rose", 345, 2.4],
  ["red", 2, 2.4],
  ["amber", 40, 2.4],
  ["green", 150, 2.2],
  ["teal", 185, 2.2],
  ["blue", 214, 2.6],
  ["indigo", 250, 2.4],
  ["violet", 276, 2.4],
  ["purple", 280, 7],
  ["sky", 208, 6],
  ["navy", 225, 11],
  ["fuchsia", 330, 6],
  ["orange", 25, 6],
  ["lime", 95, 5.5],
  ["emerald", 160, 6.5],
  ["yellow", 50, 6],
  ["crimson", 350, 6.5],
];

/** The surfaces a name sits on: the page and cards, and `bg-muted`, which is
 * the hover on a member row and the stripe on a roster row. */
const surfaces = {
  light: (hue: number, sat: number): Record<string, Rgb> => ({
    white: hsl(0, 0, 1),
    muted: hsl(hue, (sat * 5) / 100, 0.96),
  }),
  dark: (hue: number, sat: number): Record<string, Rgb> => ({
    background: hsl(hue, (sat * 6) / 100, 0.07),
    card: hsl(hue, (sat * 5) / 100, 0.1),
    muted: hsl(hue, (sat * 4) / 100, 0.16),
  }),
};

/** Text under 18.66px, which is what `text-xs` and `text-sm` are. */
const AA_SMALL = 4.5;

/** The light and dark hex values of a mark, read out of its class names. */
function shipped(mark: NameMark): { light: string; dark: string } {
  const found = /^text-\[(#[0-9a-f]{6})\] dark:text-\[(#[0-9a-f]{6})\]$/.exec(
    NAME_MARK_CLASS[mark],
  );
  if (!found) throw new Error(`unreadable class for ${mark}`);
  return { light: found[1], dark: found[2] };
}

describe("the name mark colours", () => {
  for (const mark of Object.keys(NAME_MARK_CLASS) as NameMark[]) {
    for (const scheme of ["light", "dark"] as const) {
      it(`clears AA for ${mark} in the ${scheme} scheme on every base`, () => {
        const colour = hex(shipped(mark)[scheme]);
        for (const [base, hue, sat] of BASES) {
          for (const [name, surface] of Object.entries(
            surfaces[scheme](hue, sat),
          )) {
            expect(
              contrast(colour, surface),
              `${base}/${name}`,
            ).toBeGreaterThanOrEqual(AA_SMALL);
          }
        }
      });
    }
  }
});
