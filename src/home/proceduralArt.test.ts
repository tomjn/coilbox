import { describe, expect, it } from "vitest";
import {
  FALLBACK_THEME_COLOR,
  parseColor,
  proceduralCardArt,
  proceduralCardArtSvg,
  schemeLightness,
} from "./proceduralArt";

/**
 * The scheme most of this file works in. The generator draws for the card it
 * fills, and every property below except the palette is the same either way, so
 * they are stated once against the dark card the field was authored for.
 */
const DARK = "dark" as const;
const LIGHT = "light" as const;

const BLUE = "hsl(221.2 83.2% 53.3%)";
const ORANGE = "rgb(240, 130, 30)";
/** picoframe's default scheme, which resolves to a near-neutral grey. */
const NEUTRAL = "hsl(240 4% 16%)";

/** A spread of tool ids and themes, for the properties that hold over both. */
const TOOLS = ["warpath", "replays", "campaigns", "maps", "lobby"];
const THEMES = [BLUE, ORANGE, NEUTRAL, "#ff0000", "#0f0"];

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

/** The markup with every colour removed, so two themes compare on geometry. */
function strip(svg: string): string {
  return svg.replace(/hsl\([^)]*\)/g, "colour");
}

/** The field gradient only, which is what sits directly under a card's text. */
function fieldColours(svg: string) {
  const field = /<linearGradient[^>]*>([\s\S]*?)<\/linearGradient>/.exec(svg);
  expect(field).not.toBeNull();
  return colours(field?.[1] ?? "");
}

describe("proceduralCardArtSvg", () => {
  it("is deterministic for the same tool and theme", () => {
    expect(proceduralCardArtSvg("warpath", BLUE, DARK)).toBe(
      proceduralCardArtSvg("warpath", BLUE, DARK),
    );
  });

  it("gives different tools different art", () => {
    const ids = ["warpath", "replays", "campaigns", "maps", "conquest"];
    const art = ids.map((id) => proceduralCardArtSvg(id, BLUE, DARK));
    expect(new Set(art).size).toBe(ids.length);
  });

  it("gives the same tool different art under a different theme", () => {
    expect(proceduralCardArtSvg("warpath", BLUE, DARK)).not.toBe(
      proceduralCardArtSvg("warpath", ORANGE, DARK),
    );
  });

  it("draws the same composition whatever the theme colour turns out to be", () => {
    // The condition the determinism test above cannot see. The theme colour is
    // probed off the live document, so it can arrive late, arrive rounded a
    // digit differently, or fail to resolve at all. While the composition was
    // seeded from it, any of those redrew the card rather than retinting it, and
    // the cards visibly rearranged between launches (issue #1047).
    //
    // Compared with the colours stripped, so this fails on a change of geometry
    // and stays quiet on a change of palette, which is the intended behaviour.
    const themes = [BLUE, ORANGE, NEUTRAL, "#ff0000", "240 calc(1 * 6%) 16%"];
    const shapes = themes.map((theme) =>
      strip(proceduralCardArtSvg("warpath", theme, DARK)),
    );
    expect(new Set(shapes).size).toBe(1);
  });

  it("still draws a different composition for each tool", () => {
    // The other half of the same property: geometry must depend on the tool id,
    // or seeding off the id alone would give every card one picture.
    const ids = ["warpath", "replays", "campaigns", "maps", "conquest"];
    const shapes = ids.map((id) => strip(proceduralCardArtSvg(id, BLUE, DARK)));
    expect(new Set(shapes).size).toBe(ids.length);
  });

  it("is one svg element with the canvas it was authored against", () => {
    const svg = proceduralCardArtSvg("warpath", BLUE, DARK);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg.match(/<svg /g)).toHaveLength(1);
    expect(svg).toContain('viewBox="0 0 320 200"');
  });

  it("defines every gradient it paints with", () => {
    const svg = proceduralCardArtSvg("warpath", BLUE, DARK);
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
      [
        ...proceduralCardArtSvg(tool, BLUE, DARK).matchAll(/ id="([^"]+)"/g),
      ].map((m) => m[1]);
    expect(idsOf("warpath")).not.toEqual(idsOf("replays"));
  });

  it("keeps the field dark on a dark card", () => {
    for (const tool of TOOLS) {
      for (const theme of THEMES) {
        for (const colour of fieldColours(
          proceduralCardArtSvg(tool, theme, DARK),
        )) {
          expect(colour.l).toBeLessThanOrEqual(22);
        }
      }
    }
  });

  it("keeps the field light on a light card", () => {
    // Issue #1044 gave the card the page's ramp, so the field that used to be
    // dark whatever the page was doing now follows it.
    for (const tool of TOOLS) {
      for (const theme of THEMES) {
        for (const colour of fieldColours(
          proceduralCardArtSvg(tool, theme, LIGHT),
        )) {
          expect(colour.l).toBeGreaterThanOrEqual(78);
        }
      }
    }
  });

  it("draws one composition in two ramps, rather than two pictures", () => {
    // What keeps the two schemes a family: same geometry, same hues, same
    // saturations, and a lightness derived from the dark card's own value.
    for (const tool of TOOLS) {
      const dark = colours(proceduralCardArtSvg(tool, BLUE, DARK));
      const light = colours(proceduralCardArtSvg(tool, BLUE, LIGHT));
      expect(strip(proceduralCardArtSvg(tool, BLUE, LIGHT))).toBe(
        strip(proceduralCardArtSvg(tool, BLUE, DARK)),
      );
      expect(light).toHaveLength(dark.length);
      dark.forEach((colour, i) => {
        expect(light[i].h).toBe(colour.h);
        expect(light[i].s).toBe(colour.s);
      });
    }
  });

  it("keeps the rings a visible mark on a light card, not a wash", () => {
    // Issue #1064. The rings are the whole difference between the procedural
    // field and a blank panel, and an exact mirror left them at 36 where they
    // barely read. They are the last colour in the markup.
    for (const tool of TOOLS) {
      const rings = colours(proceduralCardArtSvg(tool, BLUE, LIGHT)).at(-1);
      expect(rings?.l).toBeLessThan(30);
    }
  });

  it("keeps its marks quiet enough to sit behind an icon and a name", () => {
    const svg = proceduralCardArtSvg("warpath", BLUE, DARK);
    expect(svg).toContain('stroke-opacity="0.13"');
    expect(svg).toContain('stop-opacity="0.22"');
    expect(svg).not.toContain('opacity="1"');
  });

  it("follows the theme's hue", () => {
    // Orange is around 40 degrees, blue around 221. Allowing for the per-card
    // jitter, the two must not land in the same part of the wheel.
    const hue = (theme: string) =>
      fieldColours(proceduralCardArtSvg("warpath", theme, DARK))[0].h;
    expect(Math.abs(hue(ORANGE) - hue(BLUE))).toBeGreaterThan(90);
  });

  it("stays neutral for a theme that has no hue of its own", () => {
    // Clamping a grey theme's saturation up would give every card a colour the
    // app never chose.
    for (const colour of fieldColours(
      proceduralCardArtSvg("warpath", NEUTRAL, DARK),
    )) {
      expect(colour.s).toBeLessThanOrEqual(6);
    }
  });

  it("saturates a theme that does have a hue", () => {
    for (const colour of fieldColours(
      proceduralCardArtSvg("warpath", BLUE, DARK),
    )) {
      expect(colour.s).toBeGreaterThanOrEqual(15);
    }
  });

  it("still produces art from a theme colour it cannot parse", () => {
    // What `--primary` computes to under the default scheme, where the calc is
    // left unevaluated.
    const soup = "240 calc(1 * 6%) 16%";
    expect(proceduralCardArtSvg("warpath", soup, DARK)).toContain("<svg ");
    expect(proceduralCardArtSvg("warpath", soup, DARK)).toBe(
      proceduralCardArtSvg("warpath", soup, DARK),
    );
  });
});

/**
 * The light ramp, stated once. `bundledArt.ts` calls this too, so a change here
 * fails as one number rather than as thirty drawings quietly drifting.
 */
describe("schemeLightness", () => {
  it("leaves a dark card's value alone", () => {
    for (const dark of [8, 17, 54, 70, 80]) {
      expect(schemeLightness(DARK, dark)).toBe(dark);
    }
  });

  it("mirrors the field exactly", () => {
    // The field is what `cardShell.ts` guarantees the label's contrast against,
    // so it stays the exact mirror it has always been. Every field lightness in
    // either file sits at or below 22.
    expect(schemeLightness(LIGHT, 8)).toBe(92);
    expect(schemeLightness(LIGHT, 17)).toBe(83);
    expect(schemeLightness(LIGHT, 22)).toBe(78);
  });

  it("pushes a mark past the mirror, the brighter the further", () => {
    // Issue #1064. An exact mirror is correct arithmetic and the wrong
    // perceptual result: the same lightness step is a far bigger fraction of a
    // near-black field than of a near-white one, so a mark that glows on a dark
    // card merely recedes when inverted onto a light one.
    expect(schemeLightness(LIGHT, 54)).toBeCloseTo(38.27, 2);
    expect(schemeLightness(LIGHT, 64)).toBeCloseTo(25.6, 2);
    expect(schemeLightness(LIGHT, 70)).toBeCloseTo(18, 2);
    expect(schemeLightness(LIGHT, 80)).toBeCloseTo(5.33, 2);
  });

  it("keeps the marks in the order the drawing put them in", () => {
    // The push must not reshuffle which mark the eye lands on, or the light
    // card would be a different picture rather than the same one.
    const light = [30, 40, 50, 54, 58, 64, 70, 80, 90].map((dark) =>
      schemeLightness(LIGHT, dark),
    );
    expect(light).toEqual([...light].sort((a, b) => b - a));
  });

  it("never runs off the end of the ramp", () => {
    expect(schemeLightness(LIGHT, 100)).toBe(0);
    expect(schemeLightness(LIGHT, 0)).toBe(100);
  });
});

describe("proceduralCardArt", () => {
  it("is an svg data url holding exactly the markup", () => {
    const url = proceduralCardArt("warpath", BLUE, DARK);
    expect(url.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(url.slice("data:image/svg+xml,".length))).toBe(
      proceduralCardArtSvg("warpath", BLUE, DARK),
    );
  });

  it("encodes the characters that would end the url early", () => {
    const url = proceduralCardArt("warpath", BLUE, DARK);
    expect(url).not.toContain("#");
    expect(url).not.toContain('"');
  });

  it("is deterministic", () => {
    expect(proceduralCardArt("warpath", BLUE, DARK)).toBe(
      proceduralCardArt("warpath", BLUE, DARK),
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
