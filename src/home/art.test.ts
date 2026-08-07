import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CardArtRequest,
  type CardArtStep,
  forgetThemeColor,
  readThemeColor,
  registerCardArtSource,
  resolveCardArt,
} from "./art";
import { FALLBACK_THEME_COLOR, proceduralCardArt } from "./proceduralArt";

const THEME = "hsl(221.2 83.2% 53.3%)";

/** Sources registered by a case, removed again after it. */
const registered: (() => void)[] = [];

function register(step: CardArtStep, answer: string | false | undefined) {
  registered.push(registerCardArtSource(step, () => answer));
}

afterEach(() => {
  while (registered.length) registered.pop()?.();
  forgetThemeColor();
});

describe("resolveCardArt", () => {
  it("falls through to procedural on a fresh install", () => {
    // Nothing registered is the shipping state today, and the state a
    // distribution with no art of its own stays in.
    expect(resolveCardArt("warpath", THEME)).toEqual({
      kind: "art",
      url: proceduralCardArt("warpath", THEME),
      source: "procedural",
    });
  });

  it("lets the distribution override win over everything", () => {
    register("override", "coilbox://localhost/portable/art/warpath.png");
    register("content", "coilbox://localhost/unitsyncthumb/map.png");
    register("bundled", "/art/warpath.svg");
    expect(resolveCardArt("warpath", THEME)).toEqual({
      kind: "art",
      url: "coilbox://localhost/portable/art/warpath.png",
      source: "override",
    });
  });

  it("lets content win when the distribution says nothing", () => {
    register("content", "coilbox://localhost/unitsyncthumb/map.png");
    register("bundled", "/art/warpath.svg");
    expect(resolveCardArt("warpath", THEME)).toEqual({
      kind: "art",
      url: "coilbox://localhost/unitsyncthumb/map.png",
      source: "content",
    });
  });

  it("lets a bundled illustration win when nothing above it answers", () => {
    register("bundled", "/art/warpath.svg");
    expect(resolveCardArt("warpath", THEME)).toEqual({
      kind: "art",
      url: "/art/warpath.svg",
      source: "bundled",
    });
  });

  it("keeps the order the chain declares, not the order sources registered", () => {
    // The three sibling issues land in any order, so registering bottom-up must
    // not put the bundled illustration in front of the override.
    register("bundled", "/art/warpath.svg");
    register("content", "coilbox://localhost/unitsyncthumb/map.png");
    register("override", "coilbox://localhost/portable/art/warpath.png");
    expect(resolveCardArt("warpath", THEME).source).toBe("override");
  });

  it("returns the icon-only card when a source says the tool takes no art", () => {
    // `art: false` in the distribution contract. Distinct from finding nothing,
    // which is why it stops the chain rather than falling through to procedural.
    register("override", false);
    register("content", "coilbox://localhost/unitsyncthumb/map.png");
    expect(resolveCardArt("replays", THEME)).toEqual({
      kind: "icon",
      source: "override",
    });
  });

  it("treats undefined and an empty string as nothing to say", () => {
    register("override", undefined);
    register("content", "");
    register("bundled", "/art/warpath.svg");
    expect(resolveCardArt("warpath", THEME).source).toBe("bundled");
  });

  it("asks each source about the tool and the theme", () => {
    const seen: CardArtRequest[] = [];
    registered.push(
      registerCardArtSource("override", (request) => {
        seen.push(request);
        return undefined;
      }),
    );
    resolveCardArt("warpath", THEME);
    expect(seen).toEqual([{ toolId: "warpath", themeColor: THEME }]);
  });

  it("stops asking once a source has answered", () => {
    const later = vi.fn(() => undefined);
    register("override", "/art/warpath.svg");
    registered.push(registerCardArtSource("content", later));
    resolveCardArt("warpath", THEME);
    expect(later).not.toHaveBeenCalled();
  });

  it("replaces a step's source rather than stacking two on it", () => {
    register("content", "/first.svg");
    register("content", "/second.svg");
    expect(resolveCardArt("warpath", THEME)).toEqual({
      kind: "art",
      url: "/second.svg",
      source: "content",
    });
  });

  it("forgets a source once it is unregistered", () => {
    const remove = registerCardArtSource("override", () => "/art/warpath.svg");
    remove();
    expect(resolveCardArt("warpath", THEME).source).toBe("procedural");
  });

  it("gives different tools different procedural art", () => {
    const warpath = resolveCardArt("warpath", THEME);
    const replays = resolveCardArt("replays", THEME);
    expect(warpath).not.toEqual(replays);
  });
});

describe("readThemeColor", () => {
  it("falls back to the accent colour with no document to probe", () => {
    // Vitest runs in a node environment, so this is the no-DOM branch.
    expect(readThemeColor()).toBe(FALLBACK_THEME_COLOR);
  });

  it("is what resolveCardArt uses when the caller passes no theme", () => {
    expect(resolveCardArt("warpath")).toEqual(
      resolveCardArt("warpath", readThemeColor()),
    );
  });
});
