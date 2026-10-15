import { beforeEach, describe, expect, it, vi } from "vitest";

const { dlGithubReleaseArchives } = vi.hoisted(() => ({
  dlGithubReleaseArchives: vi.fn(),
}));
vi.mock("./bindings", () => ({ dlGithubReleaseArchives }));

const { heldGithubReleases, invalidateGithubReleases, loadGithubReleases } =
  await import("./githubReleases");

const archive = {
  filename: "a.sdz",
  url: "https://example.test/a.sdz",
  size: 1,
  tag: "v1",
  publishedAt: null,
};

beforeEach(() => {
  invalidateGithubReleases();
  vi.clearAllMocks();
  dlGithubReleaseArchives.mockResolvedValue({ archives: [archive] });
});

describe("the GitHub release cache", () => {
  it("makes one backend call for callers asking together", async () => {
    const [a, b] = await Promise.all([
      loadGithubReleases("o/n"),
      loadGithubReleases("o/n"),
    ]);
    expect(a).toEqual([archive]);
    expect(b).toBe(a);
    expect(dlGithubReleaseArchives).toHaveBeenCalledTimes(1);
  });

  it("serves a later ask from the cache and exposes it as held", async () => {
    expect(heldGithubReleases("o/n")).toBeUndefined();
    await loadGithubReleases("o/n");
    await loadGithubReleases("o/n");
    expect(dlGithubReleaseArchives).toHaveBeenCalledTimes(1);
    expect(heldGithubReleases("o/n")).toEqual([archive]);
  });

  it("keeps repositories apart", async () => {
    await loadGithubReleases("o/one");
    await loadGithubReleases("o/two");
    expect(dlGithubReleaseArchives).toHaveBeenCalledTimes(2);
    expect(dlGithubReleaseArchives).toHaveBeenCalledWith({ repo: "o/two" });
  });

  it("does not remember a rejection", async () => {
    dlGithubReleaseArchives.mockRejectedValueOnce(new Error("rate limited"));
    await expect(loadGithubReleases("o/n")).rejects.toThrow("rate limited");
    expect(heldGithubReleases("o/n")).toBeUndefined();
    await expect(loadGithubReleases("o/n")).resolves.toEqual([archive]);
    expect(dlGithubReleaseArchives).toHaveBeenCalledTimes(2);
  });

  it("asks again on refresh and keeps the held list when that fails", async () => {
    await loadGithubReleases("o/n");
    dlGithubReleaseArchives.mockRejectedValueOnce(new Error("down"));
    await expect(loadGithubReleases("o/n", true)).rejects.toThrow("down");
    expect(heldGithubReleases("o/n")).toEqual([archive]);
    dlGithubReleaseArchives.mockResolvedValueOnce({ archives: [] });
    await loadGithubReleases("o/n", true);
    expect(heldGithubReleases("o/n")).toEqual([]);
  });

  it("does not store a read that an invalidation overtook", async () => {
    let finish: (v: unknown) => void = () => {};
    dlGithubReleaseArchives.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const read = loadGithubReleases("o/n");
    invalidateGithubReleases();
    finish({ archives: [archive] });
    await read;
    expect(heldGithubReleases("o/n")).toBeUndefined();
  });
});
