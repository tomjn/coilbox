import { beforeEach, describe, expect, it } from "vitest";
import { rememberShortnames, resetShortnames } from "../container/shortnames";
import { equivalentOf, NO_EQUIVALENTS } from "./equivalents";
import {
  equivalentsFor,
  equivalentsKey,
  loadEquivalents,
  rememberEquivalence,
  resetEquivalents,
} from "./equivalentsStore";

/** A webview's storage, which is what this really writes to. */
function stubStorage() {
  const held = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => held.set(key, value),
      removeItem: (key: string) => held.delete(key),
    },
  });
  return held;
}

beforeEach(() => {
  stubStorage();
  resetEquivalents();
  resetShortnames();
});

describe("equivalentsKey", () => {
  it("keys a game by its shortname, so an update does not lose the table", () => {
    rememberShortnames([{ name: "BAR 1.2", info: { shortname: "byar" } }]);
    expect(equivalentsKey("BAR 1.2")).toBe("byar");
    expect(equivalentsKey("BAR 1.3")).toBe("bar 1.3");
  });

  it("falls back to the archive name for a game with no shortname read", () => {
    expect(equivalentsKey("Scratch Mod 0.1")).toBe("scratch mod 0.1");
  });

  it("has no key for no game, because a table belongs to one", () => {
    expect(equivalentsKey(undefined)).toBe("");
    expect(equivalentsKey("  ")).toBe("");
  });
});

describe("rememberEquivalence", () => {
  it("keeps what was said for the game it was said about", () => {
    rememberEquivalence("byar", "Armada", "armpw", "Cortex", "corak");
    expect(equivalentOf("armpw", "Cortex", equivalentsFor("byar"))).toBe(
      "corak",
    );
    expect(equivalentsFor("other")).toEqual(NO_EQUIVALENTS);
  });

  it("is still there for the next session", () => {
    rememberEquivalence("byar", "Armada", "armpw", "Cortex", "corak");
    resetEquivalents();
    loadEquivalents();
    expect(equivalentOf("armpw", "Cortex", equivalentsFor("byar"))).toBe(
      "corak",
    );
  });

  it("keeps nothing for no game, because there is nothing to key it by", () => {
    rememberEquivalence("", "Armada", "armpw", "Cortex", "corak");
    expect(equivalentsFor("")).toEqual(NO_EQUIVALENTS);
  });

  it("survives a webview with no storage at all", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("off");
        },
        setItem: () => {
          throw new Error("off");
        },
      },
    });
    loadEquivalents();
    rememberEquivalence("byar", "Armada", "armpw", "Cortex", "corak");
    expect(equivalentOf("armpw", "Cortex", equivalentsFor("byar"))).toBe(
      "corak",
    );
  });
});
