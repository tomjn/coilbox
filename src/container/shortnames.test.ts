import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadShortnames,
  rememberedShortname,
  rememberedShortnames,
  rememberShortnames,
  resetShortnames,
} from "./shortnames";

const STORAGE_KEY = "coilbox.container.shortnames";

// The node test env has no localStorage at all, so the whole store is a Map.
const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  resetShortnames();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetShortnames();
});

describe("rememberShortnames", () => {
  it("holds the shortname of every game in a scan", () => {
    rememberShortnames([
      { name: "BAR 1.2", info: { shortname: "BAR", version: "1.2" } },
      { name: "SplinterFaction 0.1.78", info: { shortname: "SF" } },
    ]);
    expect(rememberedShortname("BAR 1.2")).toBe("BAR");
    expect(rememberedShortname("SplinterFaction 0.1.78")).toBe("SF");
  });

  it("keeps an older build's shortname when a newer one arrives", () => {
    rememberShortnames([
      { name: "SplinterFaction 0.1.77", info: { shortname: "SF" } },
    ]);
    rememberShortnames([
      { name: "SplinterFaction 0.1.78", info: { shortname: "SF" } },
    ]);
    expect(rememberedShortname("SplinterFaction 0.1.77")).toBe("SF");
  });

  it("takes the newer reading for a name read twice", () => {
    rememberShortnames([{ name: "Scratch", info: { shortname: "old" } }]);
    rememberShortnames([{ name: "Scratch", info: { shortname: "new" } }]);
    expect(rememberedShortname("Scratch")).toBe("new");
  });

  it("ignores a game whose modinfo names no shortname", () => {
    rememberShortnames([
      { name: "No modinfo", info: {} },
      { name: "Blank", info: { shortname: "  " } },
      { name: "  ", info: { shortname: "X" } },
    ]);
    expect(rememberedShortnames().size).toBe(0);
  });

  it("writes nothing when the scan says nothing new", () => {
    rememberShortnames([{ name: "BAR 1.2", info: { shortname: "BAR" } }]);
    store.delete(STORAGE_KEY);
    rememberShortnames([{ name: "BAR 1.2", info: { shortname: "BAR" } }]);
    expect(store.has(STORAGE_KEY)).toBe(false);
  });
});

describe("what carries over between sessions", () => {
  it("reads back what an earlier session wrote", () => {
    rememberShortnames([
      { name: "SplinterFaction 0.1.77", info: { shortname: "SF" } },
    ]);
    resetShortnames();
    expect(rememberedShortname("SplinterFaction 0.1.77")).toBeUndefined();
    loadShortnames();
    expect(rememberedShortname("SplinterFaction 0.1.77")).toBe("SF");
  });

  it("starts empty rather than throwing on text that is not JSON", () => {
    store.set(STORAGE_KEY, "{not json");
    loadShortnames();
    expect(rememberedShortnames().size).toBe(0);
  });

  it("drops an entry that is not a string", () => {
    store.set(STORAGE_KEY, JSON.stringify({ "BAR 1.2": "BAR", Bad: 42 }));
    loadShortnames();
    expect(rememberedShortname("BAR 1.2")).toBe("BAR");
    expect(rememberedShortname("Bad")).toBeUndefined();
  });

  it("survives storage being switched off entirely", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() =>
      rememberShortnames([{ name: "BAR 1.2", info: { shortname: "BAR" } }]),
    ).not.toThrow();
    expect(rememberedShortname("BAR 1.2")).toBe("BAR");
  });
});
