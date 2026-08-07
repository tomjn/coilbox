import { describe, expect, it } from "vitest";
import {
  FALLBACK_THEME_COLOR,
  parseColor,
  proceduralCardArt,
  proceduralCardArtSvg,
} from "./proceduralArt";

const BLUE = "hsl(221.2 83.2% 53.3%)";
const ORANGE = "rgb(240, 130, 30)";
/** picoframe's default scheme, which resolves to a near-neutral grey. */
const NEUTRAL = "hsl(240 4% 16%)";

/** Every `hsl(...)` colour in a fragment of the markup, as components. */
function colours(markup: string): { h: number; s: number; l: number }[] {
  return [...markup.matchAll(/hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)/g)].map(
    (m) => ({
      h: Number(m[1]),
      s: Number(m[2]),
      l: Number(m[3]),
    }),
  );
}

/** The field gradient only, which is what sits directly under a card's text. */
function fieldColours(svg: string) {
  const field = /<linearGradient[^>]*>([\s\S]*?)<\/linearGradient>/.exec(svg);
  expect(field).not.toBeNull();
  return colours(field?.[1] ?? "");
}

describe("proceduralCardArtSvg", () => {
  it("is deterministic for the same tool and theme", () => {
    expect(proceduralCardArtSvg("warpath", BLUE)).toBe(
      proceduralCardArtSvg("warpath", BLUE),
    );
  });

  it("gives different tools different art", () => {
    const ids = ["warpath", "replays", "campaigns", "maps", "conquest"];
    const art = ids.map((id) => proceduralCardArtSvg(id, BLUE));
    expect(new Set(art).size).toBe(ids.length);
  });

  it("gives the same tool different art under a different theme", () => {
    expect(proceduralCardArtSvg("warpath", BLUE)).not.toBe(
      proceduralCardArtSvg("warpath", ORANGE),
    );
  });

  it("is one svg element with the canvas it was authored against", () => {
    const svg = proceduralCardArtSvg("warpath", BLUE);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg.match(/<svg /g)).toHaveLength(1);
    expect(svg).toContain('viewBox="0 0 320 200"');
  });

  it("defines every gradient it paints with", () => {
    const svg = proceduralCardArtSvg("warpath", BLUE);
    const defined = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    const used = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const id of used) expect(defined).toContain(id);
    // Duplicate ids would make one card's gradient resolve to another's if two
    // of these ever shared a document.
    expect(new Set(defined).size).toBe(defined.length);
  });

  it("namespaces its ids per tool", () => {
    const idsOf = (tool: string) =>
      [...proceduralCardArtSvg(tool, BLUE).matchAll(/ id="([^"]+)"/g)].map(
        (m) => m[1],
      );
    expect(idsOf("warpath")).not.toEqual(idsOf("replays"));
  });

  it("keeps the field dark so card text stays legible", () => {
    for (const tool of ["warpath", "replays", "campaigns", "maps", "lobby"]) {
      for (const theme of [BLUE, ORANGE, NEUTRAL, "#ff0000", "#0f0"]) {
        for (const colour of fieldColours(proceduralCardArtSvg(tool, theme))) {
          expect(colour.l).toBeLessThanOrEqual(22);
        }
      }
    }
  });

  it("keeps its marks quiet enough to sit behind an icon and a name", () => {
    const svg = proceduralCardArtSvg("warpath", BLUE);
    expect(svg).toContain('stroke-opacity="0.13"');
    expect(svg).toContain('stop-opacity="0.22"');
    expect(svg).not.toContain('opacity="1"');
  });

  it("follows the theme's hue", () => {
    // Orange is around 40 degrees, blue around 221. Allowing for the per-card
    // jitter, the two must not land in the same part of the wheel.
    const hue = (theme: string) =>
      fieldColours(proceduralCardArtSvg("warpath", theme))[0].h;
    expect(Math.abs(hue(ORANGE) - hue(BLUE))).toBeGreaterThan(90);
  });

  it("stays neutral for a theme that has no hue of its own", () => {
    // Clamping a grey theme's saturation up would give every card a colour the
    // app never chose.
    for (const colour of fieldColours(
      proceduralCardArtSvg("warpath", NEUTRAL),
    )) {
      expect(colour.s).toBeLessThanOrEqual(6);
    }
  });

  it("saturates a theme that does have a hue", () => {
    for (const colour of fieldColours(proceduralCardArtSvg("warpath", BLUE))) {
      expect(colour.s).toBeGreaterThanOrEqual(15);
    }
  });

  it("still produces art from a theme colour it cannot parse", () => {
    // What `--primary` computes to under the default scheme, where the calc is
    // left unevaluated.
    const soup = "240 calc(1 * 6%) 16%";
    expect(proceduralCardArtSvg("warpath", soup)).toContain("<svg ");
    expect(proceduralCardArtSvg("warpath", soup)).toBe(
      proceduralCardArtSvg("warpath", soup),
    );
  });
});

describe("proceduralCardArt", () => {
  it("is an svg data url holding exactly the markup", () => {
    const url = proceduralCardArt("warpath", BLUE);
    expect(url.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(url.slice("data:image/svg+xml,".length))).toBe(
      proceduralCardArtSvg("warpath", BLUE),
    );
  });

  it("encodes the characters that would end the url early", () => {
    const url = proceduralCardArt("warpath", BLUE);
    expect(url).not.toContain("#");
    expect(url).not.toContain('"');
  });

  it("is deterministic", () => {
    expect(proceduralCardArt("warpath", BLUE)).toBe(
      proceduralCardArt("warpath", BLUE),
    );
  });
});

describe("parseColor", () => {
  it("reads the bare triple picoframe stores in --primary", () => {
    expect(parseColor("221.2 83.2% 53.3%")).toEqual({
      h: 221.2,
      s: 83.2,
      l: 53.3,
    });
  });

  it("reads a wrapped hsl, with or without commas", () => {
    expect(parseColor("hsl(120 50% 40%)")).toEqual({ h: 120, s: 50, l: 40 });
    expect(parseColor("hsla(120, 50%, 40%, 0.5)")).toEqual({
      h: 120,
      s: 50,
      l: 40,
    });
  });

  it("reads the rgb a computed style hands back", () => {
    expect(parseColor("rgb(255, 0, 0)")).toEqual({ h: 0, s: 100, l: 50 });
    expect(parseColor("rgb(0 0 255 / 0.5)")).toEqual({ h: 240, s: 100, l: 50 });
  });

  it("reads hex in both lengths", () => {
    expect(parseColor("#00ff00")).toEqual({ h: 120, s: 100, l: 50 });
    expect(parseColor("#0f0")).toEqual({ h: 120, s: 100, l: 50 });
  });

  it("reads a grey as having no hue", () => {
    expect(parseColor("#808080")?.s).toBe(0);
  });

  it("rejects a value it cannot make a colour of", () => {
    expect(parseColor("240 calc(1 * 6%) 16%")).toBeNull();
    expect(parseColor("var(--primary)")).toBeNull();
    // Rejected whole rather than by dropping the token it could not read, which
    // would silently shift the components that follow it.
    expect(parseColor("hsl(10 20% oops 30%)")).toBeNull();
    expect(parseColor("")).toBeNull();
    expect(parseColor("rebeccapurple")).toBeNull();
  });

  it("parses its own fallback", () => {
    expect(parseColor(FALLBACK_THEME_COLOR)).not.toBeNull();
  });
});
