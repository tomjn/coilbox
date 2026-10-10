import { beforeEach, describe, expect, it, vi } from "vitest";

const { dlRecoilEngines, dlSpringfilesEngines } = vi.hoisted(() => ({
  dlRecoilEngines: vi.fn(),
  dlSpringfilesEngines: vi.fn(),
}));
vi.mock("./bindings", () => ({ dlRecoilEngines, dlSpringfilesEngines }));

const {
  heldRecoilEngines,
  heldSpringfilesEngines,
  invalidateEngineLists,
  loadRecoilEngines,
  loadSpringfilesEngines,
} = await import("./engineLists");

const recoil = { releases: [], platform: "linux" };
const springfiles = { engines: [], platform: "linux", listsThisPlatform: true };

beforeEach(() => {
  invalidateEngineLists();
  vi.clearAllMocks();
  dlRecoilEngines.mockResolvedValue(recoil);
  dlSpringfilesEngines.mockResolvedValue(springfiles);
});

describe("the engine list cache", () => {
  it("makes one backend call for callers asking together", async () => {
    const [a, b] = await Promise.all([
      loadRecoilEngines(),
      loadRecoilEngines(),
    ]);
    expect(a).toBe(recoil);
    expect(b).toBe(recoil);
    expect(dlRecoilEngines).toHaveBeenCalledTimes(1);
  });

  it("serves a later ask from the cache and exposes it as held", async () => {
    expect(heldRecoilEngines()).toBeUndefined();
    await loadRecoilEngines();
    await loadRecoilEngines();
    expect(dlRecoilEngines).toHaveBeenCalledTimes(1);
    expect(heldRecoilEngines()).toBe(recoil);
  });

  it("keeps the two lists apart", async () => {
    await loadRecoilEngines();
    expect(heldSpringfilesEngines()).toBeUndefined();
    await loadSpringfilesEngines();
    expect(dlSpringfilesEngines).toHaveBeenCalledTimes(1);
    expect(heldSpringfilesEngines()).toBe(springfiles);
  });

  it("does not remember a failure", async () => {
    dlRecoilEngines.mockRejectedValueOnce(new Error("offline"));
    await expect(loadRecoilEngines()).rejects.toThrow("offline");
    expect(heldRecoilEngines()).toBeUndefined();
    expect(await loadRecoilEngines()).toBe(recoil);
    expect(dlRecoilEngines).toHaveBeenCalledTimes(2);
  });

  it("fetches again on refresh and keeps the held copy if that fails", async () => {
    await loadRecoilEngines();
    const fresh = { releases: [], platform: "mac" };
    dlRecoilEngines.mockResolvedValueOnce(fresh);
    expect(await loadRecoilEngines(true)).toBe(fresh);
    dlRecoilEngines.mockRejectedValueOnce(new Error("offline"));
    await expect(loadRecoilEngines(true)).rejects.toThrow("offline");
    expect(heldRecoilEngines()).toBe(fresh);
  });

  it("drops a read that started before an invalidation", async () => {
    let finish: (v: typeof recoil) => void = () => {};
    dlRecoilEngines.mockReturnValueOnce(
      new Promise<typeof recoil>((r) => {
        finish = r;
      }),
    );
    const read = loadRecoilEngines();
    invalidateEngineLists();
    finish(recoil);
    await read;
    expect(heldRecoilEngines()).toBeUndefined();
  });
});
