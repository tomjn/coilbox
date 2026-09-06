import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `profileArt` reuses the profile's `@`-reference parser, which imports
// defineCommand from @picoframe/plugin-sdk for its file-read binding. That
// published dist won't load under Vitest's node resolver, and nothing here
// reads a file, so stub the leaf (same shim as background.test.ts).
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { resolveCardArt } from "./art";
import {
  overriddenTools,
  publishArtOverrides,
  resetArtOverrides,
} from "./artOverride";
import { type HomeEntry, resolveHome } from "./config";
import { PICK_PRIORITY } from "./contentArt";
import { proceduralCardArt } from "./proceduralArt";
import { readArtMap, resolveCardArtOverrides } from "./profileArt";

const THEME = "hsl(221.2 83.2% 53.3%)";

// A distribution author's only feedback that the page they are looking at is
// not the page they configured, so the warnings are part of the contract.
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  resetArtOverrides();
});

/** The resolved page a profile's `home` key describes. */
const entriesOf = (home: unknown): readonly HomeEntry[] =>
  resolveHome(home).entries;

/** A profile whose cards zone carries `art`. */
const withArt = (art: unknown) =>
  entriesOf({ zones: [{ zone: "greeting" }, { zone: "cards", art }] });

describe("a distribution with no art of its own", () => {
  it("overrides nothing when there is no home key at all", () => {
    // The hard requirement of the whole milestone: no shipped distribution has
    // a `home` key, so every one of them has to come out of here empty-handed.
    expect(resolveCardArtOverrides(entriesOf(undefined)).size).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("overrides nothing when the page lists zones but no art", () => {
    expect(resolveCardArtOverrides(withArt(undefined)).size).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("overrides nothing when the page has no cards zone", () => {
    const entries = entriesOf({ zones: [{ zone: "greeting" }] });
    expect(resolveCardArtOverrides(entries).size).toBe(0);
  });

  it("leaves every card decided by the step that decided it before", () => {
    // Step 1 registered but silent is the shipping state, so no card resolves
    // through it and no installed distribution sees a different page. That the
    // page is byte-identical is proved by a markup diff against main, in the PR.
    publishArtOverrides(resolveCardArtOverrides(entriesOf(undefined)));
    for (const toolId of [...PICK_PRIORITY, "runlite.list", "nothing.at.all"]) {
      expect(resolveCardArt(toolId, THEME, "dark").source, toolId).not.toBe(
        "override",
      );
    }
  });

  it("leaves an unnamed tool on the procedural floor, as before", () => {
    publishArtOverrides(resolveCardArtOverrides(entriesOf(undefined)));
    expect(resolveCardArt("nothing.at.all", THEME, "dark")).toEqual({
      kind: "art",
      url: proceduralCardArt("nothing.at.all", THEME, "dark"),
      source: "procedural",
    });
  });
});

describe("a distribution that names its own art", () => {
  const entries = withArt({
    "play.skirmish": "@.coilbox/art/skirmish.png",
    "play.replays": false,
  });

  it("rewrites a file reference onto the coilbox protocol", () => {
    expect(resolveCardArtOverrides(entries).get("play.skirmish")).toBe(
      "coilbox://localhost/portable/art/skirmish.png",
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps false, which is the icon-only card", () => {
    expect(resolveCardArtOverrides(entries).get("play.replays")).toBe(false);
  });

  it("says nothing about a tool it did not name", () => {
    expect(resolveCardArtOverrides(entries).has("library.maps")).toBe(false);
  });

  it("reads the surviving cards zone when one is repeated", () => {
    // `resolveHome` keeps the first of a repeated zone, and the art has to come
    // off the zone that is actually on the page.
    const page = entriesOf({
      zones: [
        { zone: "cards", art: { "play.skirmish": "@.coilbox/first.png" } },
        { zone: "cards", art: { "play.skirmish": "@.coilbox/second.png" } },
      ],
    });
    expect(resolveCardArtOverrides(page).get("play.skirmish")).toBe(
      "coilbox://localhost/portable/first.png",
    );
  });
});

describe("art the distribution got wrong", () => {
  it.each([
    ["a string", "@.coilbox/art"],
    ["a number", 3],
    ["a boolean", true],
    ["an array", [{ warpath: "@.coilbox/art/warpath.png" }]],
  ])("ignores the whole map when art is %s", (_label, art) => {
    expect(readArtMap(art).size).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it.each([
    ["true, which is not a way to ask for art", true],
    ["a number", 7],
    ["null", null],
    ["an object", { path: "@.coilbox/art/warpath.png" }],
    ["an empty string", ""],
    ["a bare relative path", "art/warpath.png"],
    ["an absolute path", "/art/warpath.png"],
    ["a path escaping the distribution folder", "@.coilbox/../warpath.png"],
    ["a namespace that does not name a file", "@route/singleplayer"],
    ["a widget reference", "@widget/resume"],
    ["a reference with nothing after it", "@.coilbox/"],
  ])("drops a tool whose art is %s, and keeps the rest", (_label, value) => {
    const overrides = readArtMap({
      warpath: value,
      "play.replays": "@.coilbox/art/replays.png",
    });
    expect(overrides.has("warpath")).toBe(false);
    expect(overrides.get("play.replays")).toBe(
      "coilbox://localhost/portable/art/replays.png",
    );
    expect(warn).toHaveBeenCalled();
  });

  it("leaves a dropped tool walking the rest of the chain", () => {
    // The point of dropping rather than blanking: the card still gets a picture.
    publishArtOverrides(readArtMap({ warpath: "art/warpath.png" }));
    expect(resolveCardArt("warpath", THEME, "dark").source).toBe("procedural");
  });

  it("does not resolve inherited Object properties as art", () => {
    // Same reasoning as the zone registry: a Map, not an object lookup.
    const overrides = readArtMap({});
    expect(overrides.get("constructor")).toBeUndefined();
    expect(overrides.get("toString")).toBeUndefined();
  });

  it("treats a tool id that shadows the prototype as an ordinary key", () => {
    // Written through JSON.parse, because an object literal's `__proto__` sets
    // the prototype rather than adding a key, and a profile arrives as JSON.
    const art = JSON.parse('{"__proto__": "@.coilbox/art/x.png"}');
    expect(readArtMap(art).get("__proto__")).toBe(
      "coilbox://localhost/portable/art/x.png",
    );
  });
});

describe("the override step of the chain", () => {
  it("wins over everything below it", () => {
    publishArtOverrides(readArtMap({ warpath: "@.coilbox/art/warpath.png" }));
    expect(resolveCardArt("warpath", THEME, "dark")).toEqual({
      kind: "art",
      url: "coilbox://localhost/portable/art/warpath.png",
      source: "override",
    });
  });

  it("gives the icon-only card for a tool switched off", () => {
    publishArtOverrides(readArtMap({ warpath: false }));
    expect(resolveCardArt("warpath", THEME, "dark")).toEqual({
      kind: "icon",
      source: "override",
    });
  });

  it("names the tools it has spoken for, images and false alike", () => {
    publishArtOverrides(
      readArtMap({ warpath: "@.coilbox/art/warpath.png", replays: false }),
    );
    expect([...overriddenTools()].sort()).toEqual(["replays", "warpath"]);
  });

  it("hands back the same set on every read, so an effect can depend on it", () => {
    publishArtOverrides(readArtMap({ warpath: false }));
    expect(overriddenTools()).toBe(overriddenTools());
  });

  it("is empty again once reset", () => {
    publishArtOverrides(readArtMap({ warpath: false }));
    resetArtOverrides();
    expect(overriddenTools().size).toBe(0);
    expect(resolveCardArt("warpath", THEME, "dark").source).toBe("procedural");
  });
});

/**
 * The art half of what the profile health panel lists (issue #1080). The panel
 * passes a collector into the same call the page makes, so a dropped tool is
 * named there in the words the console got.
 */
describe("collecting what the art map dropped", () => {
  it("collects nothing from a map it accepted whole", () => {
    const issues: string[] = [];
    readArtMap(
      { warpath: "@.coilbox/art/warpath.png", replays: false },
      issues,
    );
    expect(issues).toStrictEqual([]);
  });

  it("collects one line per tool it dropped, naming the tool", () => {
    const issues: string[] = [];
    readArtMap({ warpath: "art/warpath.png", replays: 7 }, issues);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain("warpath");
    expect(issues[1]).toContain("replays");
  });

  it("collects the one complaint when the whole map is wrong", () => {
    const issues: string[] = [];
    readArtMap("@.coilbox/art", issues);
    expect(issues).toHaveLength(1);
  });

  it("collects exactly what it warned, so the panel cannot drift", () => {
    const issues: string[] = [];
    readArtMap({ warpath: 7, replays: [] }, issues);
    expect(warn.mock.calls).toStrictEqual(issues.map((i) => [i]));
  });

  it("reaches the art through the page, from the cards zone that survived", () => {
    const issues: string[] = [];
    resolveCardArtOverrides(withArt({ warpath: "art/warpath.png" }), issues);
    expect(issues).toHaveLength(1);
  });

  it("collects nothing for a distribution with no home key", () => {
    const issues: string[] = [];
    resolveCardArtOverrides(entriesOf(undefined), issues);
    expect(issues).toStrictEqual([]);
  });
});
