import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ZONES,
  type HomeEntry,
  resolveHome,
  zoneString,
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
  it("passes a pinned name through", () => {
    // Unrecognised names are the registry's business, so any string reaches it.
    expect(resolveHome({ layout: "stacked" }).layout).toBe("stacked");
    expect(resolveHome({ layout: "mosaic" }).layout).toBe("mosaic");
    expect(warn).not.toHaveBeenCalled();
  });

  it("ignores a layout that is not a string", () => {
    expect(resolveHome({ layout: 3 }).layout).toBeUndefined();
    expect(warn).toHaveBeenCalled();
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
    expect(resolved).toEqual({ kind: "zone", zone: "cards", entry });
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

describe("zoneString", () => {
  it("returns the author's string", () => {
    expect(zoneString({ title: "Splinter Faction" }, "title")).toBe(
      "Splinter Faction",
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns undefined for a key the author left out", () => {
    expect(zoneString({}, "title")).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps an empty string, which is a deliberate blank line", () => {
    expect(zoneString({ tagline: "" }, "tagline")).toBe("");
  });

  it("ignores a value that is not a string", () => {
    expect(zoneString({ title: { text: "hi" } }, "title")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
