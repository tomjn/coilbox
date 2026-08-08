import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ZONES, type HomeEntry, resolveHome } from "./config";

// Vitest runs in node with no DOM, so the layout is called as a function and the
// element tree it returns is walked (same approach as greeting.test.ts). Each
// zone is stubbed with a marker the walker can name, which is also what keeps
// this test about the layout's ordering and spacing rather than about six zones.
const { zone } = vi.hoisted(() => ({
  zone: (name: string) => Object.assign(() => null, { zoneName: name }),
}));
vi.mock("@picoframe/frame", () => ({ Slot: zone("slot") }));
vi.mock("./zones/Onboarding", () => ({ default: zone("onboarding") }));
vi.mock("./zones/Greeting", () => ({ default: zone("greeting") }));
vi.mock("./zones/Continue", () => ({ default: zone("continue") }));
vi.mock("./zones/ResumeRail", () => ({ default: zone("resume") }));
vi.mock("./zones/ToolCards", () => ({ default: zone("cards") }));
vi.mock("./zones/SuggestedMap", () => ({
  default: zone("suggested"),
  // The same zone, as the grid renders it. Named apart so a test can tell which
  // of the two forms the layout reached for.
  SuggestedMapCard: zone("suggested-card"),
}));
// Stubbed for the same reason, and because the real one parses HTML through
// DOMParser, which the node test environment does not have. What it renders is
// `HomeMarkup`'s business. What reaches it, and where, is this test's.
vi.mock("./HomeMarkup", () => ({ default: zone("markup") }));

// The backdrop's own resolution is `background.test.ts`'s subject. What matters
// here is that the raw configured value reaches it untouched, so it is a spy.
const { background } = vi.hoisted(() => ({ background: vi.fn() }));
vi.mock("./background", () => ({
  resolveHomeBackground: (value: unknown) => {
    background(value);
    return { kind: "default" };
  },
  backdropStyle: () => ({ backgroundImage: "wash" }),
}));

import StackedLayout from "./StackedLayout";

/** A rendered zone: which one, what the layout wrapped it in, what it was given. */
type Rendered = {
  name: string;
  /** The className of the nearest wrapping element. */
  wrapper: string | null;
  props: Record<string, unknown>;
};

/** The class the layout puts on the column the zones sit in. */
const COLUMN = "relative p-8";

/** The class on the row the continue hero and the resume rail share. */
const RESUME_ROW =
  "mt-6 flex flex-col gap-3 empty:hidden sm:flex-row sm:flex-wrap sm:items-start";

/** Walk an element tree and list the stubbed zones it reached, in order. */
function collect(node: unknown, wrapper: string | null, out: Rendered[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, wrapper, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  const props = el.props ?? {};
  if (typeof el.type === "function" && "zoneName" in el.type) {
    out.push({ name: String(el.type.zoneName), wrapper, props });
    // The map card reaches the grid as a prop rather than a child, and the grid
    // puts it in a group. Walking it keeps this list in the order the page reads.
    collect(props.suggested, wrapper, out);
    return;
  }
  // Only host elements (a string type) carry the layout's own spacing classes.
  const inner =
    typeof el.type === "string" && typeof props.className === "string"
      ? props.className
      : wrapper;
  collect(props.children, inner, out);
}

/** Render the layout for a set of entries and list what came out. */
function render(entries: readonly HomeEntry[], bg: unknown = undefined) {
  const out: Rendered[] = [];
  collect(StackedLayout({ entries, background: bg }), null, out);
  return out;
}

/** Render the page an unconfigured install gets. */
const renderDefault = () => render(resolveHome(undefined).entries);

describe("StackedLayout ordering", () => {
  it("renders every zone in the default order, between the two slots", () => {
    // Every zone, in `DEFAULT_ZONES` order. The last of them arrives inside the
    // grid rather than after it, which is the map card joining the Downloads
    // group.
    expect(DEFAULT_ZONES.at(-1)).toBe("suggested");
    expect(renderDefault().map((r) => r.name)).toEqual([
      "slot",
      ...DEFAULT_ZONES.slice(0, -1),
      "suggested-card",
      "slot",
    ]);
  });

  it("bookends the zones with home.top and home.bottom", () => {
    // The slots are picoframe's extension points, not entries a distribution
    // moves, so they stay put whatever `home.zones` says.
    const rendered = render(
      resolveHome({ zones: [{ zone: "cards" }] }).entries,
    );
    expect(rendered.map((r) => r.props.id)).toEqual([
      "home.top",
      undefined,
      "home.bottom",
    ]);
  });

  it("renders exactly the configured zones, in the configured order", () => {
    const { entries } = resolveHome({
      zones: [{ zone: "suggested" }, { zone: "greeting" }],
    });
    expect(render(entries).map((r) => r.name)).toEqual([
      "slot",
      "suggested",
      "greeting",
      "slot",
    ]);
  });
});

describe("StackedLayout distribution markup", () => {
  /** What the layout rendered, as `name` or `markup:<what it was handed>`. */
  const names = (entries: readonly HomeEntry[]) =>
    render(entries).map((r) =>
      r.name === "markup" ? `markup:${r.props.markup}` : r.name,
    );

  const page = (zones: unknown[]) => names(resolveHome({ zones }).entries);

  it("renders a custom html entry in the position it was written", () => {
    expect(page([{ html: "<p>A</p>" }, { zone: "cards" }])).toEqual([
      "slot",
      "markup:<p>A</p>",
      "cards",
      "slot",
    ]);
    expect(page([{ zone: "cards" }, { html: "<p>Z</p>" }])).toEqual([
      "slot",
      "cards",
      "markup:<p>Z</p>",
      "slot",
    ]);
    expect(
      page([{ zone: "greeting" }, { html: "<p>M</p>" }, { zone: "cards" }]),
    ).toEqual(["slot", "greeting", "markup:<p>M</p>", "cards", "slot"]);
  });

  it("puts before above the zone and after below it", () => {
    expect(page([{ zone: "cards", before: "<p>B</p>" }])).toEqual([
      "slot",
      "markup:<p>B</p>",
      "cards",
      "slot",
    ]);
    expect(page([{ zone: "cards", after: "<p>A</p>" }])).toEqual([
      "slot",
      "cards",
      "markup:<p>A</p>",
      "slot",
    ]);
    expect(
      page([{ zone: "cards", before: "<p>B</p>", after: "<p>A</p>" }]),
    ).toEqual(["slot", "markup:<p>B</p>", "cards", "markup:<p>A</p>", "slot"]);
  });

  it("takes before and after on any zone, not just one", () => {
    expect(
      page([
        { zone: "greeting", before: "<p>1</p>" },
        { zone: "continue", after: "<p>2</p>" },
        { zone: "suggested", before: "<p>3</p>" },
      ]),
    ).toEqual([
      "slot",
      "markup:<p>1</p>",
      "greeting",
      "continue",
      "markup:<p>2</p>",
      "markup:<p>3</p>",
      "suggested",
      "slot",
    ]);
  });

  it("hands a file reference over unresolved, for HomeMarkup to look up", () => {
    // The layout never reads a file. Resolution happened at startup, and this
    // is the key it was filed under.
    expect(page([{ html: "@.coilbox/community.html" }])).toEqual([
      "slot",
      "markup:@.coilbox/community.html",
      "slot",
    ]);
  });

  it("keeps a zone's markup inside that zone's spacing wrapper", () => {
    // So an intro sentence takes the gap that separated the zone from what came
    // before it, and the zone sits tight under the sentence.
    const rendered = render(
      resolveHome({
        zones: [{ zone: "suggested", before: "<p>B</p>", after: "<p>A</p>" }],
      }).entries,
    );
    expect(rendered.map((r) => r.wrapper)).toEqual([
      COLUMN,
      "mt-8 empty:hidden",
      "mt-8 empty:hidden",
      "mt-8 empty:hidden",
      COLUMN,
    ]);
  });

  it("gives a custom html entry no spacing of the layout's own", () => {
    // It is a section the layout knows nothing about, so its author owns the
    // margins rather than fighting one picked here.
    const rendered = render(
      resolveHome({ zones: [{ html: "<p>x</p>" }] }).entries,
    );
    expect(rendered.map((r) => r.wrapper)).toEqual([COLUMN, COLUMN, COLUMN]);
  });

  it("renders a zone's markup whether or not the zone draws anything", () => {
    // Continue renders nothing when there is nothing to resume, and the layout
    // cannot know that. A `before` that means "sometimes" would be harder to
    // author against than one that means "always".
    expect(page([{ zone: "continue", before: "<p>Jump back in</p>" }])).toEqual(
      ["slot", "markup:<p>Jump back in</p>", "continue", "slot"],
    );
  });

  it("keeps an empty string, which the renderer draws as nothing", () => {
    expect(page([{ zone: "cards", before: "" }])).toEqual([
      "slot",
      "markup:",
      "cards",
      "slot",
    ]);
  });

  it("ignores markup that is not a string", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(page([{ zone: "cards", before: { text: "<p>x</p>" } }])).toEqual([
      "slot",
      "cards",
      "slot",
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("ignores before and after on a custom entry, which is markup already", () => {
    expect(page([{ html: "<p>x</p>", before: "<p>b</p>" }])).toEqual([
      "slot",
      "markup:<p>x</p>",
      "slot",
    ]);
  });
});

describe("StackedLayout spacing", () => {
  it("keeps each zone's gap wherever the zone is placed", () => {
    const { entries } = resolveHome({
      zones: [{ zone: "suggested" }, { zone: "continue" }],
    });
    const wrappers = Object.fromEntries(
      render(entries).map((r) => [r.name, r.wrapper]),
    );
    expect(wrappers.suggested).toBe("mt-8 empty:hidden");
    expect(wrappers.continue).toBe("mt-6 empty:hidden");
  });

  it("does not wrap a zone that needs no spacing of its own", () => {
    // The greeting and the tool grid sat directly in the column before the zone
    // list was configurable, and an empty wrapper would be a markup change.
    const wrappers = Object.fromEntries(
      renderDefault().map((r) => [r.name, r.wrapper]),
    );
    expect(wrappers.greeting).toBe(COLUMN);
    expect(wrappers.cards).toBe(COLUMN);
    expect(wrappers.onboarding).toBe("mb-2 flex flex-col gap-4");
  });
});

describe("StackedLayout resume row", () => {
  /** The wrapper each zone was rendered inside, by zone name. */
  const wrappers = (zones: unknown[]) =>
    Object.fromEntries(
      render(resolveHome({ zones }).entries).map((r) => [r.name, r.wrapper]),
    );

  it("puts the hero and the rail in one row on the default page", () => {
    const w = Object.fromEntries(
      renderDefault().map((r) => [r.name, r.wrapper]),
    );
    expect(w.continue).toBe(RESUME_ROW);
    expect(w.resume).toBe(RESUME_ROW);
  });

  it("gives the row a top margin and nothing to either zone", () => {
    // One wrapper, so the block has one gap above it rather than the hero's gap
    // and then the rail's. `empty:hidden` on that one wrapper is what makes the
    // whole block leave no gap when both zones stand down.
    expect(RESUME_ROW).toContain("mt-6");
    expect(RESUME_ROW).toContain("empty:hidden");
  });

  it("lets the rail keep its own height next to a taller hero", () => {
    // A flex row stretches its items, so a hero whose title wrapped pulled the
    // rail's cards to its own depth and left 84px between each card's detail and
    // the action pinned to its foot (#1074). Only from `sm`: below that the row
    // is a column and this would be a width.
    expect(RESUME_ROW).toContain("sm:items-start");
    expect(RESUME_ROW).not.toContain(" items-start");
  });

  it("tells the hero how wide to be, and the rail nothing", () => {
    // The width is the layout's decision. The rail's default as a flex item is
    // already what it wants: size to the cards it has, do not grow.
    const rendered = render(resolveHome(undefined).entries);
    const hero = rendered.find((r) => r.name === "continue");
    const rail = rendered.find((r) => r.name === "resume");
    expect(hero?.props.className).toBe("min-w-0 sm:max-w-2xl");
    expect(rail?.props).toEqual({});
  });

  it("caps a lone hero as well as one sharing the row", () => {
    // A profile that separated the zones asked for them apart, not for a card as
    // wide as the window with its action out at the far edge (#1059).
    const rendered = render(
      resolveHome({ zones: [{ zone: "continue" }] }).entries,
    );
    expect(rendered.find((r) => r.name === "continue")?.props.className).toBe(
      "min-w-0 sm:max-w-2xl",
    );
  });

  it("leaves them stacked when the profile separates them", () => {
    const w = wrappers([
      { zone: "continue" },
      { zone: "cards" },
      { zone: "resume" },
    ]);
    expect(w.continue).toBe("mt-6 empty:hidden");
    expect(w.resume).toBe("mt-3 empty:hidden");
  });

  it("leaves them stacked when the profile reverses them", () => {
    // The author wrote the rail first on purpose, and a row would silently undo
    // the order they asked for.
    const w = wrappers([{ zone: "resume" }, { zone: "continue" }]);
    expect(w.resume).toBe("mt-3 empty:hidden");
    expect(w.continue).toBe("mt-6 empty:hidden");
  });

  it("leaves a lone hero and a lone rail with their own spacing", () => {
    expect(wrappers([{ zone: "continue" }]).continue).toBe("mt-6 empty:hidden");
    expect(wrappers([{ zone: "resume" }]).resume).toBe("mt-3 empty:hidden");
  });

  it("does not pair a zone carrying markup of its own", () => {
    // Markup renders whether or not its zone drew anything, so inside the row it
    // would be a third item beside the hero and would hold the row open on a
    // page with nothing to resume.
    const before = wrappers([
      { zone: "continue", before: "<p>Jump back in</p>" },
      { zone: "resume" },
    ]);
    expect(before.continue).toBe("mt-6 empty:hidden");
    expect(before.resume).toBe("mt-3 empty:hidden");

    const after = wrappers([
      { zone: "continue" },
      { zone: "resume", after: "<p>More below</p>" },
    ]);
    expect(after.continue).toBe("mt-6 empty:hidden");
    expect(after.resume).toBe("mt-3 empty:hidden");
  });

  it("still pairs when the markup was dropped as unusable", () => {
    // A non-string `before` never reaches the page, so there is nothing to hold
    // the row open and no reason to break the row up.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = wrappers([
      { zone: "continue", before: { text: "<p>x</p>" } },
      { zone: "resume" },
    ]);
    expect(w.continue).toBe(RESUME_ROW);
    expect(w.resume).toBe(RESUME_ROW);
    warn.mockRestore();
  });

  it("keeps the rest of the page in order around the row", () => {
    expect(
      render(
        resolveHome({
          zones: [
            { zone: "greeting" },
            { zone: "continue" },
            { zone: "resume" },
            { zone: "cards" },
          ],
        }).entries,
      ).map((r) => r.name),
    ).toEqual(["slot", "greeting", "continue", "resume", "cards", "slot"]);
  });
});

describe("StackedLayout suggested map", () => {
  /** What the layout rendered, by name. */
  const page = (zones: unknown[]) =>
    render(resolveHome({ zones }).entries).map((r) => r.name);

  it("hands the map card to the grid when the two zones are adjacent", () => {
    // A map suggestion is a download, so it joins the Downloads group rather
    // than standing alone below every tool group (issue #1037).
    expect(page([{ zone: "cards" }, { zone: "suggested" }])).toEqual([
      "slot",
      "cards",
      "suggested-card",
      "slot",
    ]);
  });

  it("leaves the zone standing on its own when the profile separates them", () => {
    // Its own section, with its own heading, which is why the zone still has
    // one.
    expect(
      page([{ zone: "cards" }, { zone: "greeting" }, { zone: "suggested" }]),
    ).toEqual(["slot", "cards", "greeting", "suggested", "slot"]);
  });

  it("leaves it standing on its own when the profile reverses them", () => {
    expect(page([{ zone: "suggested" }, { zone: "cards" }])).toEqual([
      "slot",
      "suggested",
      "cards",
      "slot",
    ]);
  });

  it("does not fold a zone carrying markup of its own into the grid", () => {
    // The markup would land inside a group, between two cards.
    expect(
      page([{ zone: "cards" }, { zone: "suggested", before: "<p>B</p>" }]),
    ).toEqual(["slot", "cards", "markup", "suggested", "slot"]);
    expect(
      page([{ zone: "cards", after: "<p>A</p>" }, { zone: "suggested" }]),
    ).toEqual(["slot", "cards", "markup", "suggested", "slot"]);
  });

  it("gives a grid holding the card no spacing wrapper of its own", () => {
    // The grid brought its own top margin before the card joined it, and the
    // suggested zone's `mt-8` would now be a gap inside a group.
    const rendered = render(
      resolveHome({ zones: [{ zone: "cards" }, { zone: "suggested" }] })
        .entries,
    );
    expect(rendered.map((r) => r.wrapper)).toEqual([
      COLUMN,
      COLUMN,
      COLUMN,
      COLUMN,
    ]);
  });
});

describe("StackedLayout zone config", () => {
  it("hands the greeting the wording its entry carries", () => {
    const { entries } = resolveHome({
      zones: [{ zone: "greeting", title: "Splinter Faction", tagline: "Go." }],
    });
    const [greeting] = render(entries).filter((r) => r.name === "greeting");
    expect(greeting.props).toEqual({
      title: "Splinter Faction",
      tagline: "Go.",
    });
  });

  it("hands the greeting nothing when the entry says nothing", () => {
    const [greeting] = renderDefault().filter((r) => r.name === "greeting");
    expect(greeting.props).toEqual({ title: undefined, tagline: undefined });
  });
});

describe("StackedLayout backdrop", () => {
  it("passes the configured background through untouched", () => {
    background.mockClear();
    render(
      resolveHome({ background: "@.coilbox/bg.jpg" }).entries,
      "@.coilbox/bg.jpg",
    );
    expect(background).toHaveBeenCalledWith("@.coilbox/bg.jpg");
  });

  it("passes undefined when the profile configures none", () => {
    background.mockClear();
    renderDefault();
    expect(background).toHaveBeenCalledWith(undefined);
  });
});
