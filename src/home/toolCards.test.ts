import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { twMerge } from "tailwind-merge";
import { afterEach, describe, expect, it, vi } from "vitest";

// The zone reads the frame's nav and opens external links through Tauri. Vitest
// runs in node with no DOM, and @picoframe/frame's published dist uses
// extensionless relative imports the node resolver won't load, so both are
// stubbed (same approach as greeting.test.ts).
// A card asks the theme which scheme it is drawing for. Dark is the default here
// because it is what the generators answer with no document, so a card and a test
// calling a generator directly agree without either of them naming a scheme.
const theme = vi.hoisted(() => ({ resolved: "dark" as "dark" | "light" }));
// The frame's nav, swapped by the cases that render the whole grid. Empty by
// default, which is what the single-card cases below want.
const frame = vi.hoisted(() => ({ nav: [] as unknown[] }));
vi.mock("@picoframe/frame", () => ({
  useFrame: () => frame,
  useTheme: () => theme,
  // The shared links card merges class lists through it. The real
  // tailwind-merge, because which of two competing utilities wins is the point.
  cn: (...parts: unknown[]) => twMerge(parts.filter(Boolean).join(" ")),
  // The links card's chips. Only that they render matters here, so this is the
  // element without the variant classes.
  Button: ({ children }: { children?: unknown }) =>
    createElement("button", { type: "button" }, children as never),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

import type { NavItem } from "@picoframe/plugin-sdk";
import { Rocket } from "lucide-react";
import { type CardArtStep, registerCardArtSource } from "./art";
import { ART_BAND_CLASS, ART_CARD_CLASS } from "./cardShell";
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

/** A source that answers per tool, for the cases with a mixed group. */
function registerByTool(
  step: CardArtStep,
  answers: Record<string, string | false | undefined>,
) {
  registered.push(registerCardArtSource(step, ({ toolId }) => answers[toolId]));
}

afterEach(() => {
  while (registered.length) registered.pop()?.();
  theme.resolved = "dark";
  frame.nav = [];
});

/** One card as the markup a browser would get. */
function render(item: NavItem, compact = false): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ToolCard, { item, compact }),
    ),
  );
}

/** The `src` of the card's art layer, or null when it painted no art. */
function artSrc(html: string): string | null {
  return /<img[^>]*\bsrc="([^"]*)"/.exec(html)?.[1] ?? null;
}

/** The icon chip only the compact card draws. */
const CHIP = "bg-muted text-muted-foreground";

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
    // `art: false`, the per-tool override of issue #1000, in a row where every
    // other card is pictureless too. The pre-#991 card, unchanged: an icon chip
    // beside the label, and a card no taller than that.
    register("override", false);
    const html = render(SKIRMISH, true);
    expect(artSrc(html)).toBeNull();
    expect(html).toContain(CHIP);
    expect(html).toContain("Skirmish");
    expect(html).not.toContain("min-h-28");
  });

  it("keeps the art card's footprint when the row has pictures in it", () => {
    // The mixed row of issue #1113. The card has no picture and cannot borrow
    // one, so it takes the art card's shape with a plain panel where the picture
    // would go, and puts the icon and the name in the band at the foot where the
    // cards either side of it put theirs.
    register("override", false);
    const html = render(SKIRMISH);
    expect(artSrc(html)).toBeNull();
    expect(html).toContain(ART_CARD_CLASS);
    expect(html).toContain(ART_BAND_CLASS);
    // The panel: the art window's own height, on a surface of its own so it
    // reads as a choice rather than as a picture that failed to load.
    expect(html).toContain("relative min-h-28 flex-1 bg-muted");
    // One icon and one name, in the band. Not the compact card's chip as well.
    expect(html).not.toContain(CHIP);
    expect(html).toContain("Skirmish");
    expect(html.match(/lucide-rocket/g)).toHaveLength(1);
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

describe("how tall a row of pictureless cards is", () => {
  /** A group of two tools, and a second group so the first is not the page. */
  const REPLAYS: NavItem = {
    id: "play.replays",
    label: "Replays",
    to: "/replays",
    icon: Rocket,
  };
  const NAV = [
    { id: "play", label: "Play", items: [{ ...SKIRMISH }, { ...REPLAYS }] },
    {
      id: "downloads",
      label: "Downloads",
      items: [
        {
          id: "downloads.maps",
          label: "Maps",
          to: "/downloads/maps",
          icon: Rocket,
        },
      ],
    },
  ];

  /** The whole grid, optionally with a stand-in for the suggested map card. */
  function grid(suggested?: string): string {
    frame.nav = NAV;
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(ToolCards, {
          suggested: suggested
            ? createElement("p", null, suggested)
            : undefined,
        }),
      ),
    );
  }

  /** One group's section, by group label. */
  function section(html: string, label: string): string {
    const found = html
      .split("<section")
      .find((part) => part.includes(`>${label}</h2>`));
    if (!found) throw new Error(`no ${label} section`);
    return found;
  }

  it("draws the compact row when every tool in the group is pictureless", () => {
    // The design's original case, and still right: nothing is wrong with a row
    // of icon cards not being full height. Only reachable through a
    // distribution, because the procedural floor never fails.
    registerByTool("override", { skirmish: false, "play.replays": false });
    const play = section(grid(), "Play");
    expect(play.match(new RegExp(CHIP, "g"))).toHaveLength(2);
    expect(play).not.toContain("min-h-28");
  });

  it("gives every pictureless card a full footprint when one tool has art", () => {
    // The mixed row of issue #1113. Skirmish is left to the procedural floor,
    // so the row has a picture in it and the row is what decides the height.
    registerByTool("override", { "play.replays": false });
    const play = section(grid(), "Play");
    expect(play).not.toContain(CHIP);
    expect(play.match(/min-h-28/g)).toHaveLength(2);
  });

  it("counts the suggested map's picture as a picture in its row", () => {
    // The map card is not a tool card and does not walk the art chain, but it
    // is a picture in the Downloads row all the same, so the tools beside it
    // keep their footprint.
    registerByTool("override", { "downloads.maps": false });
    const downloads = section(grid("SUGGESTED"), "Downloads");
    expect(downloads).toContain("SUGGESTED");
    expect(downloads).not.toContain(CHIP);
    expect(downloads).toContain("min-h-28");
  });

  it("draws the compact row where the layout hands over no map card", () => {
    // The same group on a page that placed the two zones apart. Without the map
    // card the row is pictureless throughout and may size to its content.
    registerByTool("override", { "downloads.maps": false });
    const downloads = section(grid(), "Downloads");
    expect(downloads).toContain(CHIP);
    expect(downloads).not.toContain("min-h-28");
  });

  it("leaves a group with pictures alone", () => {
    // The control: no override at all, which is every install today.
    const play = section(grid(), "Play");
    expect(play).not.toContain(CHIP);
    expect(play.match(/min-h-28/g)).toHaveLength(2);
  });
});

describe("where the suggested map's card goes", () => {
  /** The nav Coilbox has: a Downloads group, and another group either side. */
  const NAV = [
    { id: "play", label: "Play", items: [{ ...SKIRMISH }] },
    {
      id: "downloads",
      label: "Downloads",
      items: [
        { id: "downloads.maps", label: "Maps", to: "/downloads/maps" },
        { ...DOCS },
      ],
    },
    { id: "library", label: "Library", items: [{ ...SKIRMISH, id: "c" }] },
  ];

  /** The grid, with a recognisable stand-in for the map card. */
  function grid(): string {
    frame.nav = NAV;
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(ToolCards, {
          suggested: createElement("p", null, "SUGGESTED"),
        }),
      ),
    );
  }

  /** The markup of one group's section, by group label. */
  function section(html: string, label: string): string {
    const parts = html.split("<section");
    const found = parts.find((p) => p.includes(`>${label}</h2>`));
    if (!found) throw new Error(`no ${label} section`);
    return found;
  }

  it("puts it in the Downloads group and nowhere else", () => {
    // A map suggestion is a download, so it belongs beside Browse Rapid, Maps
    // and Games rather than in a section of its own at the foot of the page.
    const html = grid();
    expect(html.match(/SUGGESTED/g)).toHaveLength(1);
    expect(section(html, "Downloads")).toContain("SUGGESTED");
    expect(section(html, "Play")).not.toContain("SUGGESTED");
    expect(section(html, "Library")).not.toContain("SUGGESTED");
  });

  it("puts it after the tools and before the shared links card", () => {
    // Links leave the app, so they stay last whatever else joins the group.
    const downloads = section(grid(), "Downloads");
    expect(downloads.indexOf("Maps")).toBeLessThan(
      downloads.indexOf("SUGGESTED"),
    );
    expect(downloads.indexOf("SUGGESTED")).toBeLessThan(
      downloads.indexOf("lucide-external-link"),
    );
  });

  it("draws the same groups when the layout hands it no card", () => {
    // A profile that placed the two zones apart, and every layout that never
    // pairs them. The grid is unchanged rather than short of a group.
    frame.nav = NAV;
    const without = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(ToolCards)),
    );
    expect(without).not.toContain("SUGGESTED");
    expect(without.split("<section")).toHaveLength(4);
  });
});
