import { beforeEach, describe, expect, it } from "vitest";
import {
  clearNotedHubContainers,
  type HubImportRecord,
  hubItemIdForContainer,
  noteHubContainer,
  presenceOf,
  withHubItem,
  withRecord,
} from "./importRecord";

const record = (id: string, refs: string[]): HubImportRecord => ({
  id,
  refs,
  route: `/scenarios`,
  at: "2026-08-10T00:00:00.000Z",
});

describe("withHubItem", () => {
  it("adds the item to a route that already has a query string", () => {
    expect(withHubItem("/scenarios?import=abc", "item-1")).toBe(
      "/scenarios?import=abc&hub=item-1",
    );
  });

  it("starts a query string on a route without one", () => {
    expect(withHubItem("/scenarios", "item-1")).toBe("/scenarios?hub=item-1");
  });

  it("encodes an id that would otherwise break the query string", () => {
    expect(withHubItem("/scenarios", "a&b=c")).toBe("/scenarios?hub=a%26b%3Dc");
  });

  it("leaves the route alone when there is no item", () => {
    expect(withHubItem("/scenarios?import=abc")).toBe("/scenarios?import=abc");
  });
});

describe("noted container addresses", () => {
  beforeEach(() => clearNotedHubContainers());

  it("gives back the item an address was noted for", () => {
    noteHubContainer("https://hub.test/i/one", "one");
    expect(hubItemIdForContainer("https://hub.test/i/one")).toBe("one");
  });

  it("knows nothing about an address nothing noted", () => {
    expect(hubItemIdForContainer("https://elsewhere.test/x")).toBeUndefined();
  });

  it("forgets the oldest once too many are noted", () => {
    for (let i = 0; i < 250; i++) {
      noteHubContainer(`https://hub.test/i/${i}`, String(i));
    }
    expect(hubItemIdForContainer("https://hub.test/i/0")).toBeUndefined();
    expect(hubItemIdForContainer("https://hub.test/i/249")).toBe("249");
  });
});

describe("withRecord", () => {
  it("replaces an earlier record for the same item", () => {
    const first = record("a", ["old"]);
    const second = record("a", ["new"]);
    expect(withRecord([first], second)).toEqual([second]);
  });

  it("puts the newest first and keeps the others", () => {
    const a = record("a", ["1"]);
    const b = record("b", ["2"]);
    expect(withRecord([a], b)).toEqual([b, a]);
  });

  it("drops the oldest past the cap", () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      record(`item-${i}`, [String(i)]),
    );
    const result = withRecord(many, record("fresh", ["x"]));
    expect(result).toHaveLength(500);
    expect(result[0].id).toBe("fresh");
    expect(result.some((r) => r.id === "item-499")).toBe(false);
  });
});

describe("presenceOf", () => {
  it("says nothing was imported without a record", () => {
    expect(presenceOf(undefined, new Set())).toEqual({ state: "none" });
  });

  it("waits for the local ids before answering", () => {
    expect(presenceOf(record("a", ["x"]), null)).toEqual({ state: "unknown" });
  });

  it("says it is here when a recorded id is still there", () => {
    expect(presenceOf(record("a", ["x"]), new Set(["x", "y"]))).toEqual({
      state: "here",
      route: "/scenarios",
    });
  });

  it("says it is here while any one of several ids survives", () => {
    expect(presenceOf(record("a", ["x", "y"]), new Set(["y"]))).toEqual({
      state: "here",
      route: "/scenarios",
    });
  });

  it("stops claiming it once the imported thing is deleted", () => {
    expect(presenceOf(record("a", ["x"]), new Set(["other"]))).toEqual({
      state: "gone",
    });
  });

  it("never claims an import that left nothing behind", () => {
    expect(presenceOf(record("a", []), new Set(["x"]))).toEqual({
      state: "gone",
    });
  });

  it("addresses the surviving id when the kind can be addressed", () => {
    expect(
      presenceOf(record("a", ["x"]), new Set(["x"]), (ref) => `/here/${ref}`),
    ).toEqual({ state: "here", route: "/here/x" });
  });

  it("addresses whichever id survived, not the first one recorded", () => {
    expect(
      presenceOf(
        record("a", ["gone", "kept"]),
        new Set(["kept"]),
        (ref) => `/here/${ref}`,
      ),
    ).toEqual({ state: "here", route: "/here/kept" });
  });
});
