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
vi.mock("./zones/FeaturedMap", () => ({ default: zone("featured") }));
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
    expect(renderDefault().map((r) => r.name)).toEqual([
      "slot",
      ...DEFAULT_ZONES,
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
      zones: [{ zone: "featured" }, { zone: "greeting" }],
    });
    expect(render(entries).map((r) => r.name)).toEqual([
      "slot",
      "featured",
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
        { zone: "featured", before: "<p>3</p>" },
      ]),
    ).toEqual([
      "slot",
      "markup:<p>1</p>",
      "greeting",
      "continue",
      "markup:<p>2</p>",
      "markup:<p>3</p>",
      "featured",
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
        zones: [{ zone: "featured", before: "<p>B</p>", after: "<p>A</p>" }],
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
      zones: [{ zone: "featured" }, { zone: "continue" }],
    });
    const wrappers = Object.fromEntries(
      render(entries).map((r) => [r.name, r.wrapper]),
    );
    expect(wrappers.featured).toBe("mt-8 empty:hidden");
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
    expect(wrappers.resume).toBe("mt-3 empty:hidden");
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
