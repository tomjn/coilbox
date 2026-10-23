import { describe, expect, it } from "vitest";
import { BACKGROUND_IDS, PAGE_IDS, SETTLED_KEY } from "./ids";
import {
  addSettled,
  planRun,
  type Relevance,
  seedExistingInstall,
} from "./settle";

const all = (r: Relevance) => ({
  language: r,
  appearance: r,
  games: r,
  hub: r,
  server: r,
});

function memoryStorage(initial?: string) {
  const m = new Map<string, string>();
  if (initial !== undefined) m.set(SETTLED_KEY, initial);
  return {
    m,
    storage: {
      get: (k: string) => m.get(k) ?? null,
      set: (k: string, v: string) => m.set(k, v),
    },
  };
}

describe("planRun", () => {
  it("waits while an unsettled page is unknown", () => {
    expect(
      planRun({
        settled: [],
        relevance: { ...all(true), hub: null },
        rerun: false,
      }).status,
    ).toBe("waiting");
  });
  it("ignores unknown relevance on a settled page", () => {
    expect(
      planRun({
        settled: ["hub"],
        relevance: { ...all(false), hub: null },
        rerun: false,
      }).status,
    ).toBe("none");
  });
  it("settles irrelevant pages without opening", () => {
    expect(
      planRun({ settled: [], relevance: all(false), rerun: false }),
    ).toEqual({
      status: "none",
      settleNow: ["language", "appearance", "games", "hub", "server", "done"],
    });
  });
  it("opens a first run with relevant pages and done, settling only irrelevant ones", () => {
    expect(
      planRun({
        settled: [],
        relevance: { ...all(false), language: true, server: true },
        rerun: false,
      }),
    ).toEqual({
      status: "open",
      pages: ["language", "server", "done"],
      settleNow: ["appearance", "games", "hub"],
    });
  });
  it("leaves out done once done is settled", () => {
    const plan = planRun({
      settled: ["language", "appearance", "games", "hub", "done"],
      relevance: all(true),
      rerun: false,
    });
    expect(plan).toEqual({
      status: "open",
      pages: ["server"],
      settleNow: [],
    });
  });
  it("keeps done for a first run closed partway", () => {
    const plan = planRun({
      settled: ["language"],
      relevance: { ...all(false), server: true },
      rerun: false,
    });
    expect(plan.status === "open" && plan.pages).toEqual(["server", "done"]);
  });
  it("rerun ignores the settled list and includes done", () => {
    const plan = planRun({
      settled: ["language", "appearance", "games", "hub", "server", "done"],
      relevance: { ...all(false), hub: true },
      rerun: true,
    });
    expect(plan).toMatchObject({
      status: "open",
      pages: ["hub", "done"],
    });
  });
});

describe("addSettled", () => {
  it("dedupes", () => {
    expect(addSettled(["language"], ["language", "hub"])).toEqual([
      "language",
      "hub",
    ]);
  });
});

describe("seedExistingInstall", () => {
  it("seeds every id on an existing install", () => {
    const { m, storage } = memoryStorage();
    seedExistingInstall(storage, 3);
    expect(JSON.parse(m.get(SETTLED_KEY) as string)).toEqual([
      ...PAGE_IDS,
      ...BACKGROUND_IDS,
    ]);
  });
  it("writes an empty list on a fresh install at once", () => {
    const { m, storage } = memoryStorage();
    seedExistingInstall(storage, 0);
    expect(m.get(SETTLED_KEY)).toBe("[]");
  });
  it("keeps a fresh install's empty list on the next launch", () => {
    const { m, storage } = memoryStorage();
    seedExistingInstall(storage, 0);
    // Other code wrote settings before the app closed.
    seedExistingInstall(storage, 4);
    expect(m.get(SETTLED_KEY)).toBe("[]");
  });
  it("leaves every page unsettled when the list is empty", () => {
    expect(
      planRun({
        settled: JSON.parse("[]"),
        relevance: all(true),
        rerun: false,
      }),
    ).toEqual({
      status: "open",
      pages: [...PAGE_IDS],
      settleNow: [],
    });
  });
  it("does not overwrite an existing list", () => {
    const { m, storage } = memoryStorage('["hub"]');
    seedExistingInstall(storage, 3);
    expect(m.get(SETTLED_KEY)).toBe('["hub"]');
  });
});
