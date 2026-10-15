import { beforeEach, describe, expect, it, vi } from "vitest";

const { dlSpringfilesList, dlHakoraMaps, dlEvolutionRtsMaps } = vi.hoisted(
  () => ({
    dlSpringfilesList: vi.fn(),
    dlHakoraMaps: vi.fn(),
    dlEvolutionRtsMaps: vi.fn(),
  }),
);
vi.mock("./bindings", () => ({
  dlSpringfilesList,
  dlHakoraMaps,
  dlEvolutionRtsMaps,
}));

const {
  findInIndex,
  heldHakoraMaps,
  heldSpringfilesList,
  indexTick,
  invalidateMirrorIndexes,
  loadHakoraMaps,
  loadSpringfilesList,
} = await import("./mirrorIndex");

const maps = { results: [{ name: "a" }] };

beforeEach(() => {
  invalidateMirrorIndexes();
  vi.clearAllMocks();
  dlSpringfilesList.mockResolvedValue(maps);
  dlHakoraMaps.mockResolvedValue({ maps: [] });
});

describe("the mirror index cache", () => {
  it("makes one backend call for callers asking together", async () => {
    const [a, b] = await Promise.all([
      loadSpringfilesList("map"),
      loadSpringfilesList("map"),
    ]);
    expect(a).toBe(maps);
    expect(b).toBe(maps);
    expect(dlSpringfilesList).toHaveBeenCalledTimes(1);
  });

  it("serves a later ask from the cache and exposes it as held", async () => {
    expect(heldSpringfilesList("map")).toBeUndefined();
    await loadSpringfilesList("map");
    await loadSpringfilesList("map");
    expect(dlSpringfilesList).toHaveBeenCalledTimes(1);
    expect(heldSpringfilesList("map")).toBe(maps);
  });

  it("keeps categories and mirrors apart", async () => {
    await loadSpringfilesList("map");
    await loadSpringfilesList("game");
    await loadHakoraMaps();
    expect(dlSpringfilesList).toHaveBeenCalledTimes(2);
    expect(dlSpringfilesList).toHaveBeenCalledWith({ category: "game" });
    expect(dlHakoraMaps).toHaveBeenCalledTimes(1);
    expect(heldHakoraMaps()).toEqual({ maps: [] });
  });

  it("does not remember a rejection", async () => {
    dlSpringfilesList.mockRejectedValueOnce(new Error("down"));
    await expect(loadSpringfilesList("map")).rejects.toThrow("down");
    expect(heldSpringfilesList("map")).toBeUndefined();
    await expect(loadSpringfilesList("map")).resolves.toBe(maps);
    expect(dlSpringfilesList).toHaveBeenCalledTimes(2);
  });

  it("fetches again on a refresh and keeps the old copy if that fails", async () => {
    await loadSpringfilesList("map");
    const newer = { results: [{ name: "b" }] };
    dlSpringfilesList.mockResolvedValueOnce(newer);
    await expect(loadSpringfilesList("map", true)).resolves.toBe(newer);
    expect(heldSpringfilesList("map")).toBe(newer);

    dlSpringfilesList.mockRejectedValueOnce(new Error("down"));
    await expect(loadSpringfilesList("map", true)).rejects.toThrow("down");
    expect(heldSpringfilesList("map")).toBe(newer);
  });

  it("does not store a read that an invalidation overtook", async () => {
    let finish: (v: typeof maps) => void = () => {};
    dlSpringfilesList.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const stale = loadSpringfilesList("map");
    invalidateMirrorIndexes();
    finish(maps);
    await stale;
    expect(heldSpringfilesList("map")).toBeUndefined();
  });
});

describe("findInIndex", () => {
  const find = (name: string) => (i: typeof maps) =>
    i.results.find((r) => r.name === name);
  const read = (refresh: boolean) => loadSpringfilesList("map", refresh);

  it("does not refetch when the item is found", async () => {
    await findInIndex(read, find("a"), indexTick());
    await findInIndex(read, find("a"), indexTick());
    expect(dlSpringfilesList).toHaveBeenCalledTimes(1);
  });

  it("refetches once on a miss and finds an item added since", async () => {
    await loadSpringfilesList("map");
    const askedAt = indexTick();
    dlSpringfilesList.mockResolvedValueOnce({
      results: [{ name: "a" }, { name: "new" }],
    });
    await expect(findInIndex(read, find("new"), askedAt)).resolves.toEqual({
      name: "new",
    });
    expect(dlSpringfilesList).toHaveBeenCalledTimes(2);
  });

  it("refetches once for a pack of missing items queued together", async () => {
    await loadSpringfilesList("map");
    const askedAt = indexTick();
    for (let i = 0; i < 5; i++) {
      await expect(
        findInIndex(read, find(`missing${i}`), askedAt),
      ).resolves.toBeUndefined();
    }
    expect(dlSpringfilesList).toHaveBeenCalledTimes(2);
  });

  it("trusts a copy loaded for this ask and refetches for a later one", async () => {
    await findInIndex(read, find("zzz"), indexTick());
    expect(dlSpringfilesList).toHaveBeenCalledTimes(1);
    await findInIndex(read, find("zzz"), indexTick());
    expect(dlSpringfilesList).toHaveBeenCalledTimes(2);
  });
});
