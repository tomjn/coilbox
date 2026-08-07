import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// The zone reads the frame's nav and opens external links through Tauri. Vitest
// runs in node with no DOM, and @picoframe/frame's published dist uses
// extensionless relative imports the node resolver won't load, so both are
// stubbed (same approach as greeting.test.ts).
vi.mock("@picoframe/frame", () => ({ useFrame: () => ({ nav: [] }) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

import type { NavItem } from "@picoframe/plugin-sdk";
import { Rocket } from "lucide-react";
import { type CardArtStep, registerCardArtSource } from "./art";
import { proceduralCardArt } from "./proceduralArt";
import ToolCards, {
  ART_CLASSES,
  cardArtUrl,
  ToolCard,
} from "./zones/ToolCards";

const SKIRMISH: NavItem = {
  id: "skirmish",
  label: "Skirmish",
  to: "/play",
  icon: Rocket,
  description: "Play against bots",
};

const DOCS: NavItem = {
  id: "docs",
  label: "Docs",
  href: "https://example.test/docs",
};

/** Sources registered by a case, removed again after it. */
const registered: (() => void)[] = [];

function register(step: CardArtStep, answer: string | false | undefined) {
  registered.push(registerCardArtSource(step, () => answer));
}

afterEach(() => {
  while (registered.length) registered.pop()?.();
});

/** One card as the markup a browser would get. */
function render(item: NavItem): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(ToolCard, { item })),
  );
}

/** The `src` of the card's art layer, or null when it painted no art. */
function artSrc(html: string): string | null {
  return /<img[^>]*\bsrc="([^"]*)"/.exec(html)?.[1] ?? null;
}

describe("tool card rendering modes", () => {
  it("paints a resolved URL edge to edge behind the card", () => {
    register("bundled", "/art/skirmish.svg");
    const html = render(SKIRMISH);
    expect(artSrc(html)).toBe("/art/skirmish.svg");
    // Edge to edge means the art layer fills the card, not a panel inside it.
    expect(html).toContain("absolute inset-0 size-full object-cover");
    // Decorative: the label beside it already names the tool.
    expect(html).toContain('alt=""');
  });

  it("paints the procedural field when no source answers", () => {
    // The shipping state today, and the state a distribution with no art of its
    // own stays in.
    expect(artSrc(render(SKIRMISH))).toBe(
      proceduralCardArt("skirmish", "hsl(221.2 83.2% 53.3%)"),
    );
  });

  it("falls back to the icon-only card when a source says no art", () => {
    // `art: false`, the per-tool override of issue #1000.
    register("override", false);
    const html = render(SKIRMISH);
    expect(artSrc(html)).toBeNull();
    // The pre-#991 card, unchanged: an icon chip beside the label.
    expect(html).toContain("bg-muted text-muted-foreground");
    expect(html).toContain("Skirmish");
  });

  it("keeps the icon and the name on the art card", () => {
    register("bundled", "/art/skirmish.svg");
    const html = render(SKIRMISH);
    expect(html).toContain("Skirmish");
    expect(html).toContain("Play against bots");
    expect(html).toContain("lucide-rocket");
  });

  it("declares the art card a dark island so its text stays light", () => {
    register("bundled", "/art/skirmish.svg");
    // Both halves matter: the class that re-declares the ramp, and text that
    // reads the raw token rather than Tailwind's root-resolved one.
    expect(render(SKIRMISH)).toContain("dark flex-col");
    expect(ART_CLASSES.band).toContain("text-[hsl(var(--foreground))]");
  });
});

describe("a broken image", () => {
  it("takes the card back to the icon-only mode", () => {
    expect(
      cardArtUrl(
        { kind: "art", url: "/gone.png", source: "bundled" },
        "/gone.png",
      ),
    ).toBeNull();
  });

  it("does not condemn a different URL the chain resolves later", () => {
    // A source whose cache warms mid-session replaces the URL. The card must
    // try the new one rather than inherit the verdict on the old.
    expect(
      cardArtUrl(
        { kind: "art", url: "/fresh.png", source: "content" },
        "/gone.png",
      ),
    ).toBe("/fresh.png");
  });

  it("stays icon-only when the chain says so, broken or not", () => {
    expect(cardArtUrl({ kind: "icon", source: "override" }, null)).toBeNull();
  });

  it("wires the fallback to the image's own error", () => {
    // Static markup carries no handlers, so this asserts the prop is passed at
    // all. That it recovers the card was checked in a browser, see the PR.
    register("bundled", "/art/skirmish.svg");
    expect(render(SKIRMISH)).toContain("<img");
  });
});

describe("what a card navigates to", () => {
  it("keeps an internal route as a link to the same path", () => {
    register("bundled", "/art/skirmish.svg");
    expect(render(SKIRMISH)).toContain('href="/play"');
  });

  it("keeps an internal route as a link in icon-only mode too", () => {
    register("override", false);
    expect(render(SKIRMISH)).toContain('href="/play"');
  });

  it("keeps an external item as a button, so it opens in the OS browser", () => {
    register("bundled", "/art/docs.svg");
    const html = render(DOCS);
    expect(html).toContain("<button");
    expect(html).not.toContain("<a ");
    // The external mark stays on the card.
    expect(html).toContain("lucide-external-link");
  });

  it("marks every rendered card for the section's has-selector", () => {
    // The group `<section>` only shows itself when a visible card is inside it.
    register("bundled", "/art/skirmish.svg");
    expect(render(SKIRMISH)).toContain('data-nav-item=""');
    register("override", false);
    expect(render(SKIRMISH)).toContain('data-nav-item=""');
  });

  it("renders nothing at all for an item gated off by useVisible", () => {
    expect(render({ ...SKIRMISH, useVisible: () => false })).toBe("");
  });

  it("renders nothing when there are no tools", () => {
    // The Greeting says "No tools available yet." for this case, and relies on
    // the grid not also putting an empty box on the page. The mocked frame
    // above has an empty nav.
    expect(renderToStaticMarkup(createElement(ToolCards))).toBe("");
  });
});

/**
 * The legibility guarantee for text on card art, measured rather than eyeballed.
 *
 * What this proves: the band across the foot of an art card dims whatever is
 * under it enough that both its text colours clear WCAG AA (4.5:1) against the
 * brightest pixel the procedural field can produce, in every base ramp picoframe
 * ships. It holds identically in light and dark mode, because the card
 * re-declares the dark ramp on itself, so there is one case to check and not two.
 *
 * What it does not prove: that any of it was rendered, or that a bundled
 * illustration (issue #990) or content art (issue #989) honours the same dark
 * contract. Art brighter than the procedural field's ceiling would erode this,
 * which is why the contract is written down in `proceduralArt.ts`.
 *
 * The alphas come out of the shipped class strings, so weakening the band in the
 * component re-runs the measurement instead of leaving it stale.
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

/** Straight-alpha composite of `layer` over `base`. */
function over(base: Rgb, layer: Rgb, alpha: number): Rgb {
  return base.map((c, i) => c * (1 - alpha) + layer[i] * alpha) as Rgb;
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

/** The alpha in a `hsl(var(--token)/N)` arbitrary value, or 1 if it has none. */
function tokenAlpha(className: string, token: string): number {
  const found = new RegExp(`hsl\\(var\\(--${token}\\)(?:/([0-9.]+))?\\)`).exec(
    className,
  );
  if (!found) throw new Error(`no --${token} in ${className}`);
  return found[1] ? Number(found[1]) : 1;
}

/**
 * The brightest pixel `proceduralCardArtSvg` can paint, scanned over its whole
 * parameter space.
 *
 * Its layers, from that module: a field at up to 22% lightness and 55%
 * saturation, two glows at 22% opacity of a 58%-lightness colour at up to 70%
 * saturation, and rings at 13% of a 64%-lightness colour. The worst case for
 * text is all of them stacked on the same pixel, at whichever hue carries the
 * most luminance.
 */
function brightestProceduralPixel(): Rgb {
  let worst: Rgb = [0, 0, 0];
  for (let hue = 0; hue < 360; hue += 5) {
    let pixel = hsl(hue, 0.55, 0.22);
    pixel = over(pixel, hsl(hue, 0.7, 0.58), 0.22);
    pixel = over(pixel, hsl(hue, 0.7, 0.58), 0.22);
    pixel = over(pixel, hsl(hue, 0.7, 0.64), 0.13);
    if (luminance(pixel) > luminance(worst)) worst = pixel;
  }
  return worst;
}

/** picoframe's `.dark` ramp, transcribed from `@picoframe/frame/src/theme.css`. */
const BASE_HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
/** Neutral through the subtle tier to the vivid one, which tops out around 11. */
const BASE_SATS = [0, 1, 2.6, 6, 11];

describe("text on card art", () => {
  const art = brightestProceduralPixel();
  const bandAlpha = tokenAlpha(ART_CLASSES.band, "background");
  const textAlpha = tokenAlpha(ART_CLASSES.band, "foreground");
  const dimAlpha = tokenAlpha(ART_CLASSES.dim, "foreground");

  it("dims the art under the band", () => {
    expect(bandAlpha).toBeGreaterThan(0);
    expect(bandAlpha).toBeLessThan(1);
  });

  it("fades in from nothing above the band, so no text sits on the fade", () => {
    expect(ART_CLASSES.fade).toContain("to-transparent");
    expect(ART_CLASSES.fade).toContain("bottom-full");
  });

  for (const hue of BASE_HUES) {
    for (const sat of BASE_SATS) {
      // The dark ramp's --background, which is what the band is painted in.
      const scrim = hsl(hue, (sat * 6) / 100, 0.07);
      const band = over(art, scrim, bandAlpha);
      // The dark ramp's --foreground is achromatic, so the base does not move it.
      const ink = over(band, hsl(0, 0, 0.95), textAlpha);
      const dim = over(band, hsl(0, 0, 0.95), dimAlpha);
      const label = `base hue ${hue} sat ${sat}`;

      it(`clears AA for the tool name at ${label}`, () => {
        expect(contrast(ink, band)).toBeGreaterThanOrEqual(4.5);
      });

      it(`clears AA for the description at ${label}`, () => {
        expect(contrast(dim, band)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
