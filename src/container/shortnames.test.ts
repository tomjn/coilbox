import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  carriedShortname,
  loadShortnames,
  rememberCarriedShortname,
  rememberedShortname,
  rememberedShortnames,
  rememberShortnames,
  resetShortnames,
} from "./shortnames";

const STORAGE_KEY = "coilbox.container.shortnames";
const CARRIED_KEY = "coilbox.container.shortnames.carried";

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

describe("rememberCarriedShortname", () => {
  it("holds the shortname a shared container named its game with", () => {
    rememberCarriedShortname({
      name: "SplinterFaction 0.1.60",
      shortname: "SF",
    });
    expect(carriedShortname("SplinterFaction 0.1.60")).toBe("SF");
  });

  it("keeps a carried shortname out of what coilbox read itself", () => {
    rememberCarriedShortname({ name: "Never installed 1.0", shortname: "NI" });
    expect(rememberedShortname("Never installed 1.0")).toBeUndefined();
    expect(rememberedShortnames().size).toBe(0);
  });

  it("learns nothing from an identity naming only one of the two", () => {
    rememberCarriedShortname({ shortname: "BA" });
    rememberCarriedShortname({ name: "BAR 1.2" });
    rememberCarriedShortname(null);
    rememberCarriedShortname(undefined);
    expect(store.has(CARRIED_KEY)).toBe(false);
  });

  it("learns nothing about an archive coilbox has read the modinfo of", () => {
    rememberShortnames([{ name: "BAR 1.2", info: { shortname: "BAR" } }]);
    rememberCarriedShortname({ name: "BAR 1.2", shortname: "Imposter" });
    expect(carriedShortname("BAR 1.2")).toBeUndefined();
  });

  it("takes the newest claim for a name two containers disagree on", () => {
    rememberCarriedShortname({ name: "Mystery 1.0", shortname: "first" });
    rememberCarriedShortname({ name: "Mystery 1.0", shortname: "second" });
    expect(carriedShortname("Mystery 1.0")).toBe("second");
  });

  it("writes nothing when the container says nothing new", () => {
    rememberCarriedShortname({ name: "Mystery 1.0", shortname: "MY" });
    store.delete(CARRIED_KEY);
    rememberCarriedShortname({ name: "Mystery 1.0", shortname: "MY" });
    expect(store.has(CARRIED_KEY)).toBe(false);
  });
});

describe("what carries over between sessions", () => {
  it("reads back what an earlier session was told", () => {
    rememberCarriedShortname({ name: "Mystery 1.0", shortname: "MY" });
    resetShortnames();
    expect(carriedShortname("Mystery 1.0")).toBeUndefined();
    loadShortnames();
    expect(carriedShortname("Mystery 1.0")).toBe("MY");
  });

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
