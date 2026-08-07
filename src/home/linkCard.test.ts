import type { NavGroup } from "@picoframe/plugin-sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The grid a case is rendering. Reassigned per case, so the mocked frame below
// can hand the zone a different nav each time. Declared with `vi.hoisted` because
// `vi.mock`'s factory is hoisted above the file's own statements.
const frame = vi.hoisted(() => ({ nav: [] as NavGroup[] }));

// Same two stubs as toolCards.test.ts: vitest runs in node with no DOM, and
// @picoframe/frame's published dist uses extensionless relative imports the node
// resolver won't load. The Button primitive is stubbed to the plain element it
// renders, keeping the test about what the card does rather than how picoframe
// paints a button.
vi.mock("@picoframe/frame", async () => {
  // The real `cn`, not a join: it is tailwind-merge, and the links card leans on
  // it to let `w-fit` beat the shared shell's `w-full`. A join would hide that.
  const { clsx } = await import("clsx");
  const { twMerge } = await import("tailwind-merge");
  return {
    useFrame: () => frame,
    cn: (...parts: unknown[]) => twMerge(clsx(parts)),
    Button: ({
      children,
      ...props
    }: { children?: unknown } & Record<string, unknown>) =>
      createElement("button", { type: "button", ...props }, children as never),
  };
});

// `profile/links.ts` reaches the profile singleton, which pulls in
// @picoframe/plugin-sdk, whose published dist uses extensionless relative imports
// the node resolver won't load. Stubbing the one leaf it calls is enough, as
// profile/links.test.ts already does.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

const opened: string[] = [];
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: async (url: string) => {
    opened.push(url);
  },
}));

import { BookOpen, Rocket } from "lucide-react";
import { buildProfileNav } from "../profile/links";
import type { Profile } from "../profile/profile";
import { splitGroupItems } from "./nav";
import { openExternal } from "./navItem";
import ToolCards from "./zones/ToolCards";

/** A tool, for the groups that mix tools and links. */
const SKIRMISH = {
  id: "skirmish",
  label: "Skirmish",
  to: "/play",
  icon: Rocket,
};

/** The whole grid, as the markup a browser would get. */
function grid(nav: NavGroup[]): string {
  frame.nav = nav;
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(ToolCards)),
  );
}

/** The grid a distribution with these `profile.links` would see. */
function profileGrid(links: Profile["links"]): string {
  return grid(buildProfileNav({ links } as Profile));
}

/**
 * How many separate cards the markup drew. Every card, of either kind, is an
 * element carrying `data-nav-item` except the links card, which is the box those
 * chips sit inside - so this counts the boxes, which is what the issue is about.
 */
function cardCount(html: string): number {
  return (html.match(/data-nav-item=""/g) ?? []).length;
}

/** How many links cards the markup drew. */
function linkCardCount(html: string): number {
  return (html.match(/data-link-card=""/g) ?? []).length;
}

/** Whether the markup contains a links card at all. */
function hasLinkCard(html: string): boolean {
  return linkCardCount(html) > 0;
}

beforeEach(() => {
  opened.length = 0;
  frame.nav = [];
});

describe("splitting a group's items", () => {
  it("sends internal routes to tool cards and external ones to the links card", () => {
    const { tools, links } = splitGroupItems([
      SKIRMISH,
      { id: "wiki", label: "Wiki", href: "https://example.test/wiki" },
    ]);
    expect(tools.map((t) => t.id)).toEqual(["skirmish"]);
    expect(links.map((l) => l.id)).toEqual(["wiki"]);
  });

  it("treats an item with both as external, exactly as the tool card does", () => {
    // `ToolCard` checks `item.href` first and renders a button, so the split has
    // to agree or an item would render as a link inside the wrong card.
    const { tools, links } = splitGroupItems([
      { id: "odd", label: "Odd", to: "/odd", href: "https://example.test" },
    ]);
    expect(tools).toEqual([]);
    expect(links.map((l) => l.id)).toEqual(["odd"]);
  });
});

describe("a distribution that declares no links", () => {
  it("draws no links card at all, which is the default install", () => {
    const html = grid([{ id: "play", label: "Play", items: [SKIRMISH] }]);
    expect(hasLinkCard(html)).toBe(false);
    expect(html).toContain("Skirmish");
  });

  it("draws no links card when `profile.links` is absent", () => {
    expect(profileGrid(undefined)).toBe("");
  });
});

describe("a distribution that declares one link", () => {
  it("gives it a chip in a links card rather than a card of its own", () => {
    const html = profileGrid([
      { label: "Discord", href: "https://discord.gg/x" },
    ]);
    expect(hasLinkCard(html)).toBe(true);
    expect(html).toContain("Discord");
    // One chip, in one card. Before this the link was a full art card.
    expect(cardCount(html)).toBe(1);
    expect(html).not.toContain("object-cover");
  });

  it("keeps the group label the profile chose as the heading", () => {
    const html = profileGrid([
      { label: "Discord", href: "https://discord.gg/x", group: "Community" },
    ]);
    expect(html).toContain("Community");
  });

  it("labels an ungrouped link's section 'Links', as the sidebar does", () => {
    expect(
      profileGrid([{ label: "Site", href: "https://example.test" }]),
    ).toContain("Links");
  });
});

describe("a distribution that declares a dozen links in one group", () => {
  const MANY = Array.from({ length: 12 }, (_, i) => ({
    label: `Link ${i}`,
    href: `https://example.test/${i}`,
    group: "Community",
  }));

  it("puts every one of them in a single card", () => {
    const html = profileGrid(MANY);
    // Twelve chips, one card. The issue was twelve cards.
    expect(cardCount(html)).toBe(12);
    expect(linkCardCount(html)).toBe(1);
  });

  it("keeps every label and every destination", () => {
    const html = profileGrid(MANY);
    for (const link of MANY) {
      expect(html).toContain(link.label);
    }
    // Destinations live on the click handler, not in the markup, so they are
    // checked through the nav the sidebar and the card share.
    const items = buildProfileNav({ links: MANY } as Profile)[0].items;
    expect(items.map((i) => i.href)).toEqual(MANY.map((l) => l.href));
  });
});

describe("a distribution that declares links across several groups", () => {
  const SPREAD = [
    { label: "Discord", href: "https://discord.gg/x", group: "Community" },
    { label: "Forum", href: "https://forum.example", group: "Community" },
    { label: "Donate", href: "https://donate.example", group: "Support" },
  ];

  it("gives each group its own card, under its own heading", () => {
    const html = profileGrid(SPREAD);
    expect(linkCardCount(html)).toBe(2);
    expect(html).toContain("Community");
    expect(html).toContain("Support");
  });

  it("keeps each link under the group it was declared in", () => {
    const html = profileGrid(SPREAD);
    const support = html.indexOf("Support");
    // "Donate" is declared under Support, which sorts after Community, so it
    // must appear later in the document than the Support heading.
    expect(html.indexOf("Donate")).toBeGreaterThan(support);
    expect(html.indexOf("Discord")).toBeLessThan(support);
  });
});

describe("a group that mixes tools and links", () => {
  const MIXED: NavGroup[] = [
    {
      id: "animation",
      label: "Animation",
      items: [
        SKIRMISH,
        {
          id: "animation.skeletor",
          label: "Skeletor S3O",
          href: "https://github.com/Beherith/Skeletor_S3O",
          icon: BookOpen,
          sidebar: false,
        },
      ],
    },
  ];

  it("keeps the reference link in the group that says what it is for", () => {
    // The Animation, Mapconv and Lego reference links are `sidebar: false`, so
    // this grid is the only place they appear. Their group is their only context.
    const html = grid(MIXED);
    expect(html).toContain("Skeletor S3O");
    expect(html).toContain("Animation");
  });

  it("still gives the tool its own card", () => {
    expect(grid(MIXED)).toContain("Skirmish");
  });
});

describe("what a link chip is", () => {
  it("is a button, never an anchor, so the webview does not navigate away", () => {
    const html = profileGrid([{ label: "Docs", href: "https://docs.example" }]);
    expect(html).toContain("<button");
    expect(html).not.toContain("<a ");
    expect(html).toContain("lucide-external-link");
  });

  it("opens through the OS opener", async () => {
    openExternal("https://docs.example");
    await Promise.resolve();
    expect(opened).toEqual(["https://docs.example"]);
  });

  it("hides a link its own useVisible gates off", () => {
    const html = grid([
      {
        id: "g",
        label: "Group",
        items: [
          {
            id: "hidden",
            label: "Hidden link",
            href: "https://example.test",
            useVisible: () => false,
          },
        ],
      },
    ]);
    // No chip, so the card's `has-[[data-nav-item]]:flex` never fires and the
    // section around it stays hidden too. Nothing to show, nothing drawn.
    expect(html).not.toContain("Hidden link");
    expect(cardCount(html)).toBe(0);
  });

  it("wraps a very long label inside its chip rather than clipping it", () => {
    const long =
      "The Complete Skeletor Inverse Kinematics Animation Guide For Recoil Engine Unit Riggers";
    const html = profileGrid([{ label: long, href: "https://example.test" }]);
    // The whole label is present: no truncation, no ellipsis.
    expect(html).toContain(long);
    expect(html).not.toContain("truncate");
    // What lets it wrap: the chip drops the button variant's fixed height and
    // its `whitespace-nowrap`.
    expect(html).toContain("whitespace-normal");
    expect(html).toContain("h-auto");
    expect(html).toContain("break-words");
  });
});
