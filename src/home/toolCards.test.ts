import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// The zone reads the frame's nav and opens external links through Tauri. Vitest
// runs in node with no DOM, and @picoframe/frame's published dist uses
// extensionless relative imports the node resolver won't load, so both are
// stubbed (same approach as greeting.test.ts).
// A card asks the theme which scheme it is drawing for. Dark is the default here
// because it is what the generators answer with no document, so a card and a test
// calling a generator directly agree without either of them naming a scheme.
const theme = vi.hoisted(() => ({ resolved: "dark" as "dark" | "light" }));
vi.mock("@picoframe/frame", () => ({
  useFrame: () => ({ nav: [] }),
  useTheme: () => theme,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

import type { NavItem } from "@picoframe/plugin-sdk";
import { Rocket } from "lucide-react";
import { type CardArtStep, registerCardArtSource } from "./art";
import { ART_CARD_CLASS } from "./cardShell";
import { proceduralCardArt } from "./proceduralArt";
import ToolCards, { cardArtUrl, ToolCard } from "./zones/ToolCards";

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
  theme.resolved = "dark";
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
      proceduralCardArt("skirmish", "hsl(221.2 83.2% 53.3%)", "dark"),
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

  it("takes the shared card shell rather than its own copy of it", () => {
    register("bundled", "/art/skirmish.svg");
    // `cardShell.ts` owns why the text on card art clears AA over any picture in
    // either scheme, and measures it. This is the card claiming that guarantee.
    expect(render(SKIRMISH)).toContain(ART_CARD_CLASS);
  });

  it("draws its art for the scheme the page is in", () => {
    // The card is on the page's ramp (#1044), so the art it paints has to be
    // too, and the theme is what tells it. Without this the card would keep
    // whichever scheme it first rendered in.
    theme.resolved = "light";
    expect(artSrc(render(SKIRMISH))).toBe(
      proceduralCardArt("skirmish", "hsl(221.2 83.2% 53.3%)", "light"),
    );
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
