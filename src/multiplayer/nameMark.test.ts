import { describe, expect, it } from "vitest";
import { BASES, contrast, hsl, type Rgb } from "../lib/contrast.testhelper";
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
 * colour maths and base presets from `lib/contrast.testhelper.ts`.
 */

function hex(value: string): Rgb {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map(
    (c) => c / 255,
  ) as Rgb;
}

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
