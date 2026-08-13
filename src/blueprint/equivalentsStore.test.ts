import { beforeEach, describe, expect, it } from "vitest";
import { rememberShortnames, resetShortnames } from "../container/shortnames";
import { equivalentOf, NO_EQUIVALENTS } from "./equivalents";
import {
  equivalentsFor,
  equivalentsKey,
  forgetEquivalence,
  forgetEquivalents,
  loadEquivalents,
  rememberEquivalence,
  rememberShippedEquivalents,
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

/** Issue #1526. What a game itself says, kept beside what a person said. */
describe("rememberShippedEquivalents", () => {
  const shipped = {
    groups: [{ Armada: "armanni", Cortex: "cordoom", Legion: "legbastion" }],
  };

  it("keeps what the game said, and counts what was new about it", () => {
    expect(rememberShippedEquivalents("byar", shipped)).toBe(3);
    expect(equivalentOf("armanni", "Cortex", equivalentsFor("byar"))).toBe(
      "cordoom",
    );
  });

  it("counts nothing the second time, because nothing was new", () => {
    rememberShippedEquivalents("byar", shipped);
    expect(rememberShippedEquivalents("byar", shipped)).toBe(0);
  });

  it("leaves an answer a person gave, and counts only what it added", () => {
    rememberEquivalence("byar", "Armada", "armanni", "Cortex", "corsy");
    expect(rememberShippedEquivalents("byar", shipped)).toBe(1);
    expect(equivalentOf("armanni", "Cortex", equivalentsFor("byar"))).toBe(
      "corsy",
    );
    expect(equivalentOf("armanni", "Legion", equivalentsFor("byar"))).toBe(
      "legbastion",
    );
  });

  it("keeps nothing for no game, because there is nothing to key it by", () => {
    expect(rememberShippedEquivalents("", shipped)).toBe(0);
  });

  it("is still there for the next session", () => {
    rememberShippedEquivalents("byar", shipped);
    resetEquivalents();
    loadEquivalents();
    expect(equivalentOf("armanni", "Cortex", equivalentsFor("byar"))).toBe(
      "cordoom",
    );
  });
});

describe("forgetting (issue #1533)", () => {
  beforeEach(() => {
    rememberEquivalence("byar", "Armada", "armpw", "Cortex", "corak");
    rememberEquivalence("byar", "Armada", "armsolar", "Cortex", "corsolar");
  });

  it("drops the one pairing asked about and keeps the rest", () => {
    forgetEquivalence("byar", 0);
    expect(equivalentsFor("byar").groups).toEqual([
      { Armada: "armsolar", Cortex: "corsolar" },
    ]);
  });

  it("drops the lot for one game and leaves every other game alone", () => {
    rememberEquivalence("other", "Armada", "armpw", "Cortex", "corak");
    forgetEquivalents("byar");
    expect(equivalentsFor("byar")).toEqual(NO_EQUIVALENTS);
    expect(equivalentsFor("other").groups).toHaveLength(1);
  });

  it("stays forgotten for the next session", () => {
    forgetEquivalence("byar", 0);
    resetEquivalents();
    loadEquivalents();
    expect(equivalentOf("armpw", "Cortex", equivalentsFor("byar"))).toBe(
      undefined,
    );
  });

  it("does nothing for a pairing that is not there", () => {
    const was = equivalentsFor("byar");
    forgetEquivalence("byar", 7);
    forgetEquivalence("byar", -1);
    expect(equivalentsFor("byar")).toBe(was);
  });

  it("does nothing for no game, because there is nothing to key one by", () => {
    forgetEquivalents("");
    expect(equivalentsFor("byar").groups).toHaveLength(2);
  });
});

describe("storage that is not there", () => {
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
