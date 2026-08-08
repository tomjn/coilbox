import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ZONES,
  describeHome,
  type HomeEntry,
  resolveHome,
  zonesOnPage,
} from "./config";

// Every malformed case is supposed to say something, so the warnings are part of
// the contract rather than noise: a distribution author's only feedback that the
// page they are looking at is not the page they configured.
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

/** The zone ids of a resolved page, in order. */
const zonesOf = (entries: readonly HomeEntry[]): string[] =>
  entries.map((e) => (e.kind === "zone" ? e.zone : `html:${e.entry.html}`));

describe("resolveHome with no home key", () => {
  it("gives every zone in the default order", () => {
    // The hard requirement of the whole schema: no shipped distribution has a
    // `home` key, so this is the page all of them get.
    expect(zonesOf(resolveHome(undefined).entries)).toEqual([...DEFAULT_ZONES]);
  });

  it("tracks the default layout rather than pinning one", () => {
    expect(resolveHome(undefined).layout).toBeUndefined();
  });

  it("leaves the background unset, so the default wash is painted", () => {
    expect(resolveHome(undefined).background).toBeUndefined();
  });

  it("says nothing on the console", () => {
    resolveHome(undefined);
    expect(warn).not.toHaveBeenCalled();
  });

  it("treats an explicit null the same as an absent key", () => {
    expect(zonesOf(resolveHome(null).entries)).toEqual([...DEFAULT_ZONES]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("treats an empty object the same, without complaining", () => {
    const home = resolveHome({});
    expect(zonesOf(home.entries)).toEqual([...DEFAULT_ZONES]);
    expect(home.layout).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("resolveHome layout", () => {
  it("passes a name this build ships through", () => {
    expect(resolveHome({ layout: "stacked" }).layout).toBe("stacked");
    expect(warn).not.toHaveBeenCalled();
  });

  it("ignores a layout that is not a string", () => {
    expect(resolveHome({ layout: 3 }).layout).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("drops a name this build does not ship, and says which", () => {
    // The page drawn is the default one, so the pin reads as unset. A summary
    // that quoted "mosaic" would be describing a pin that did nothing (#1088).
    expect(resolveHome({ layout: "mosaic" }).layout).toBeUndefined();
    expect(warn.mock.calls.join("\n")).toContain("mosaic");
  });

  it("lists what the build does ship, so the author can correct it", () => {
    const { issues } = resolveHome({ layout: "mosaic" });
    expect(issues.join("\n")).toContain("stacked");
  });

  it("does not resolve an inherited Object property as a layout", () => {
    expect(resolveHome({ layout: "toString" }).layout).toBeUndefined();
    expect(resolveHome({ layout: "constructor" }).layout).toBeUndefined();
  });
});

describe("resolveHome background", () => {
  it("passes the raw value through for background.ts to interpret", () => {
    // Deliberately unvalidated here: one module decides what a backdrop value
    // means, and it already falls back to the default wash for anything else.
    expect(resolveHome({ background: "@.coilbox/bg.jpg" }).background).toBe(
      "@.coilbox/bg.jpg",
    );
    expect(resolveHome({ background: false }).background).toBe(false);
    expect(resolveHome({ background: 7 }).background).toBe(7);
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops the background when the whole home key is malformed", () => {
    expect(resolveHome("nope").background).toBeUndefined();
  });
});

describe("resolveHome zones", () => {
  it("renders exactly the listed zones, in the listed order", () => {
    const home = resolveHome({
      zones: [{ zone: "cards" }, { zone: "greeting" }],
    });
    expect(zonesOf(home.entries)).toEqual(["cards", "greeting"]);
  });

  it("hides a zone by leaving it out", () => {
    const home = resolveHome({ zones: [{ zone: "greeting" }] });
    expect(zonesOf(home.entries)).toEqual(["greeting"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps each entry verbatim, including keys this build does not use", () => {
    // The seam issues #999 and #1000 plug into. Nothing here reads `before` or
    // `art`, and nothing here is allowed to throw them away either.
    const entry = {
      zone: "cards",
      before: "<p>Tools</p>",
      art: { warpath: "@.coilbox/art/warpath.png" },
    };
    const [resolved] = resolveHome({ zones: [entry] }).entries;
    expect(resolved).toMatchObject({ kind: "zone", zone: "cards", entry });
  });

  it("recognises a custom html entry and keeps its position", () => {
    // Rendered by issue #999. Classified now so that issue is an addition, and
    // so a custom entry does not read as a malformed one in the meantime.
    const home = resolveHome({
      zones: [
        { zone: "greeting" },
        { html: "@.coilbox/community.html" },
        { zone: "cards" },
      ],
    });
    expect(zonesOf(home.entries)).toEqual([
      "greeting",
      "html:@.coilbox/community.html",
      "cards",
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("prefers the zone name when an entry carries both", () => {
    const home = resolveHome({ zones: [{ zone: "cards", html: "<p>x</p>" }] });
    expect(zonesOf(home.entries)).toEqual(["cards"]);
  });
});

describe("resolveHome zones that are wrong", () => {
  it("falls back to the default page when zones is not an array", () => {
    const home = resolveHome({ zones: { zone: "greeting" } });
    expect(zonesOf(home.entries)).toEqual([...DEFAULT_ZONES]);
    expect(warn).toHaveBeenCalled();
  });

  it("falls back to the default page when zones is empty", () => {
    // A page with nothing on it is indistinguishable from a crash, and a
    // distribution that wants the page to itself has welcome.html.
    const home = resolveHome({ zones: [] });
    expect(zonesOf(home.entries)).toEqual([...DEFAULT_ZONES]);
    expect(warn).toHaveBeenCalled();
  });

  it("falls back to the default page when every entry is bad", () => {
    const home = resolveHome({ zones: [{ zone: "nope" }, "greeting"] });
    expect(zonesOf(home.entries)).toEqual([...DEFAULT_ZONES]);
  });

  it("drops an unknown zone and keeps the rest of the list", () => {
    const home = resolveHome({
      zones: [{ zone: "greeting" }, { zone: "livestream" }, { zone: "cards" }],
    });
    expect(zonesOf(home.entries)).toEqual(["greeting", "cards"]);
    expect(warn).toHaveBeenCalledWith(
      'home: ignoring unknown zone "livestream"',
    );
  });

  it("does not resolve inherited Object properties as zones", () => {
    const home = resolveHome({
      zones: [{ zone: "constructor" }, { zone: "toString" }],
    });
    expect(zonesOf(home.entries)).toEqual([...DEFAULT_ZONES]);
  });

  it("drops an entry that is not an object", () => {
    const home = resolveHome({
      zones: ["greeting", 3, null, ["cards"], { zone: "cards" }],
    });
    expect(zonesOf(home.entries)).toEqual(["cards"]);
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("drops an entry naming neither a zone nor html", () => {
    const home = resolveHome({
      zones: [{ before: "<p>hi</p>" }, { zone: "cards" }],
    });
    expect(zonesOf(home.entries)).toEqual(["cards"]);
    expect(warn).toHaveBeenCalled();
  });

  it("keeps the first of a repeated zone and drops the rest", () => {
    const home = resolveHome({
      zones: [
        { zone: "greeting", title: "First" },
        { zone: "cards" },
        { zone: "greeting", title: "Second" },
      ],
    });
    expect(zonesOf(home.entries)).toEqual(["greeting", "cards"]);
    expect(home.entries[0]).toMatchObject({ entry: { title: "First" } });
    expect(warn).toHaveBeenCalledWith(
      'home: ignoring a repeated "greeting" zone',
    );
  });
});

describe("resolveHome when home itself is wrong", () => {
  it.each([
    ["a string", "stacked"],
    ["a number", 1],
    ["a boolean", true],
    ["an array", [{ zone: "greeting" }]],
  ])("falls back to the default page for %s", (_label, raw) => {
    const home = resolveHome(raw);
    expect(zonesOf(home.entries)).toEqual([...DEFAULT_ZONES]);
    expect(home.layout).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

/**
 * The reported issues and the console warnings are the same list (issue #1080).
 *
 * The profile health panel exists because a release build has no console, and it
 * shows `issues`. If the two could differ, the panel would describe a page the
 * app did not draw, so the property under test is that they cannot: every warning
 * is an issue, in the same words and the same order.
 */
describe("what resolveHome reports as issues", () => {
  const malformed: [string, unknown][] = [
    ["home that is not an object", "stacked"],
    ["a layout that is not a string", { layout: 3 }],
    ["zones that are not an array", { zones: { zone: "greeting" } }],
    ["an empty zone list", { zones: [] }],
    ["an entry that is not an object", { zones: ["greeting", 3, null] }],
    ["an unknown zone name", { zones: [{ zone: "livestream" }] }],
    [
      "a repeated zone",
      { zones: [{ zone: "cards" }, { zone: "cards" }, { zone: "greeting" }] },
    ],
    ["an inherited Object property", { zones: [{ zone: "constructor" }] }],
    ["an entry naming neither a zone nor html", { zones: [{ before: "<p>" }] }],
    ["a layout this build does not ship", { layout: "mosaic" }],
    ["a layout named after an Object property", { layout: "constructor" }],
    [
      "a zone option that is not a string",
      { zones: [{ zone: "greeting", title: 7, tagline: ["a"] }] },
    ],
    [
      "markup on a zone that is not a string",
      { zones: [{ zone: "cards", before: 7, after: {} }] },
    ],
    [
      "markup on a custom entry that is not a string",
      { zones: [{ html: "<p>hi</p>", before: 7 }] },
    ],
    [
      "a key written where nothing reads it",
      { zones: [{ zone: "cards", title: "Tools", html: "<p>hi</p>" }] },
    ],
    [
      "several mistakes at once",
      {
        layout: [],
        zones: [{ zone: "nope" }, 7, { zone: "greeting", title: 7 }],
      },
    ],
  ];

  it.each(malformed)("reports %s exactly as it warns", (_label, raw) => {
    const { issues } = resolveHome(raw);
    expect(issues.length).toBeGreaterThan(0);
    expect(warn.mock.calls).toStrictEqual(issues.map((i) => [i]));
  });

  it("reports nothing for a page that resolved as written", () => {
    const { issues } = resolveHome({
      layout: "stacked",
      zones: [{ zone: "greeting" }, { html: "<p>hi</p>" }, { zone: "cards" }],
    });
    expect(issues).toStrictEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports nothing for a profile with no home key", () => {
    expect(resolveHome(undefined).issues).toStrictEqual([]);
    expect(resolveHome(null).issues).toStrictEqual([]);
    expect(resolveHome({}).issues).toStrictEqual([]);
  });

  it("names the entry it dropped, so the author can find it", () => {
    const { issues } = resolveHome({ zones: [{ zone: "livestream" }] });
    expect(issues.join("\n")).toContain("livestream");
  });

  it("quotes a bad value rather than describing it", () => {
    const { issues } = resolveHome({ zones: [{ zone: "cards" }, 7] });
    expect(issues.join("\n")).toContain("7");
  });

  it("truncates a long value so one bad entry cannot fill the panel", () => {
    const { issues } = resolveHome({ zones: [{ zone: "x".repeat(500) }, 7] });
    for (const issue of issues) expect(issue.length).toBeLessThan(300);
  });
});

describe("pinned", () => {
  it("is false when no zone list was written", () => {
    expect(resolveHome(undefined).pinned).toBe(false);
    expect(resolveHome({ layout: "stacked" }).pinned).toBe(false);
  });

  it("is true when the author's list survived", () => {
    expect(resolveHome({ zones: [{ zone: "cards" }] }).pinned).toBe(true);
  });

  it("is false when the list was written but nothing in it survived", () => {
    // The page on screen is the Coilbox default, so that is what it says. A
    // summary reading "pinned" here would be describing the profile rather than
    // the page.
    expect(resolveHome({ zones: [{ zone: "nope" }] }).pinned).toBe(false);
    expect(resolveHome({ zones: "greeting" }).pinned).toBe(false);
  });
});

describe("describeHome", () => {
  it("names the layout, the zone count and the pin", () => {
    expect(
      describeHome(
        resolveHome({
          layout: "stacked",
          zones: [{ zone: "greeting" }, { zone: "cards" }],
        }),
      ),
    ).toBe('Layout "stacked", 2 zone(s), pinned');
  });

  it("says what an unconfigured page tracks", () => {
    expect(describeHome(resolveHome(undefined))).toBe(
      `Default layout, ${DEFAULT_ZONES.length} zone(s), tracking the default`,
    );
  });

  it("counts the zones that survived, not the ones written", () => {
    const home = resolveHome({
      zones: [{ zone: "greeting" }, { zone: "nope" }, { zone: "cards" }],
    });
    expect(describeHome(home)).toContain("2 zone(s)");
  });
});

/**
 * The greeting is the one zone that says something about the others, so it has to
 * know which of them the page carries (#1079, #1082). It is told by the layout,
 * off this list, so the two cannot disagree about what is on the page.
 */
describe("zonesOnPage", () => {
  /** The zones of a resolved page, sorted so the assertion is about the set. */
  const on = (raw: unknown) =>
    [...zonesOnPage(resolveHome(raw).entries)].sort();

  it("lists every zone of an unconfigured page", () => {
    expect(on(undefined)).toEqual([...DEFAULT_ZONES].sort());
  });

  it("lists only the zones the profile kept", () => {
    expect(on({ zones: [{ zone: "greeting" }, { zone: "continue" }] })).toEqual(
      ["continue", "greeting"],
    );
  });

  it("ignores custom markup entries, which are not zones", () => {
    expect(
      on({ zones: [{ zone: "greeting" }, { html: "<p>hi</p>" }] }),
    ).toEqual(["greeting"]);
  });

  it("counts a dropped entry as absent, because the page will not draw it", () => {
    expect(on({ zones: [{ zone: "greeting" }, { zone: "nope" }] })).toEqual([
      "greeting",
    ]);
  });
});

/**
 * A zone's `title`, `tagline`, `before` and `after` are resolved here rather than
 * read by the layout at render time (issue #1088).
 *
 * That is what puts them in the same list as everything else the resolver
 * dropped, without a second walk over the raw entries: the walk that builds the
 * page is the walk that checks them, and the layout renders what it was handed.
 */
describe("a zone's string options", () => {
  /** The strings resolved for the first entry of a one-zone page. */
  const strings = (entry: Record<string, unknown>) => {
    const [first] = resolveHome({ zones: [entry] }).entries;
    if (first.kind !== "zone") throw new Error("expected a zone entry");
    return first.strings;
  };

  it("carries the author's strings on the entry", () => {
    expect(strings({ zone: "greeting", title: "Splinter Faction" })).toEqual({
      title: "Splinter Faction",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves out a key the author did not write", () => {
    expect(strings({ zone: "greeting" })).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps an empty string, which is a deliberate blank", () => {
    expect(strings({ zone: "greeting", tagline: "" }).tagline).toBe("");
    expect(warn).not.toHaveBeenCalled();
  });

  it("treats null as a key left out rather than as a mistake", () => {
    expect(strings({ zone: "greeting", title: null })).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops a value that is not a string, and names the zone", () => {
    expect(strings({ zone: "greeting", title: { text: "hi" } })).toEqual({});
    expect(warn.mock.calls.join("\n")).toContain("greeting");
  });

  it("checks the markup keys on every zone, not just the greeting", () => {
    expect(strings({ zone: "cards", before: 7 })).toEqual({});
    expect(warn).toHaveBeenCalled();
  });

  it("keeps the rest of the entry when one option is wrong", () => {
    expect(strings({ zone: "greeting", title: 7, tagline: "Ready" })).toEqual({
      tagline: "Ready",
    });
  });
});

/**
 * A key written where nothing reads it (issue #1094).
 *
 * The author's next move is what separates this from a value that is wrong: a
 * key in the wrong place has to move, a bad value has to be fixed. So the two
 * complaints do not share a sentence, and the one about placement says nothing
 * about the value, because a string there would not have worked either.
 */
describe("a key the entry does not read", () => {
  /** Resolve a one-entry page and return what it complained about. */
  const issuesFor = (entry: Record<string, unknown>) =>
    resolveHome({ zones: [entry] }).issues;

  it("names a greeting-only key written on another zone", () => {
    expect(issuesFor({ zone: "cards", title: "Tools" })).toStrictEqual([
      'home: `title` does nothing on the "cards" zone',
    ]);
  });

  it("says the same whatever the value is, because the value is not the fault", () => {
    expect(issuesFor({ zone: "cards", title: 7 })).toStrictEqual(
      issuesFor({ zone: "cards", title: "Tools" }),
    );
  });

  it("names `html` on a built-in zone, which draws itself", () => {
    expect(
      issuesFor({ zone: "cards", html: "@.coilbox/home/feed.html" }),
    ).toStrictEqual(['home: `html` does nothing on the "cards" zone']);
  });

  it("does not confuse it with a value that is wrong", () => {
    const [issue] = issuesFor({ zone: "cards", before: 7 });
    expect(issue).toContain("expected a string");
    expect(issue).not.toContain("does nothing");
  });

  it("says nothing about a key the entry does read", () => {
    expect(issuesFor({ zone: "greeting", title: "Ironhold" })).toStrictEqual(
      [],
    );
    expect(issuesFor({ html: "<p>hi</p>", before: "<p>b</p>" })).toStrictEqual(
      [],
    );
  });

  it("leaves an author's own keys alone", () => {
    // `HomeZoneConfig` keeps every other key verbatim for whoever reads it, so
    // complaining about one would be this module deciding for another.
    expect(issuesFor({ zone: "cards", art: {}, note: "todo" })).toStrictEqual(
      [],
    );
  });
});

/**
 * A custom `html` entry takes `before` and `after` like any other entry (issue
 * #1094). The layout used to drop them, which is the one place the code
 * disagreed with what the documentation promises.
 */
describe("a custom html entry's string options", () => {
  /** The strings resolved for a one-entry page. */
  const strings = (entry: Record<string, unknown>) => {
    const [first] = resolveHome({ zones: [entry] }).entries;
    if (first.kind !== "html") throw new Error("expected a custom entry");
    return first.strings;
  };

  it("carries the markup around the block", () => {
    expect(
      strings({ html: "@.coilbox/feed.html", before: "<p>From the forum</p>" }),
    ).toEqual({ before: "<p>From the forum</p>" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops a value that is not a string, and names where it was", () => {
    expect(strings({ html: "<p>x</p>", after: 7 })).toEqual({});
    expect(warn.mock.calls.join("\n")).toContain("a custom `html` entry");
  });

  it("does not carry the block itself, which the entry already holds", () => {
    expect(strings({ html: "<p>x</p>" })).toEqual({});
  });
});
