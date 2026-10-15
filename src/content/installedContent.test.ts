import { beforeEach, describe, expect, it, vi } from "vitest";

const dlInstalledContent = vi.fn();
vi.mock("../downloads/bindings", () => ({
  dlInstalledContent: (args: unknown) => dlInstalledContent(args),
}));

const { installedContent, invalidateInstalledContent } = await import(
  "./installedContent"
);

const listing = { maps: ["a.sd7"], games: ["g.sdz"] };

beforeEach(() => {
  invalidateInstalledContent();
  dlInstalledContent.mockReset();
  dlInstalledContent.mockResolvedValue(listing);
});

describe("the installed content cache", () => {
  it("makes one backend call for callers asking together", async () => {
    const [a, b] = await Promise.all([
      installedContent({ paths: ["/x"] }),
      installedContent({ paths: ["/x"] }),
    ]);
    expect(a).toBe(listing);
    expect(b).toBe(listing);
    expect(dlInstalledContent).toHaveBeenCalledTimes(1);
  });

  it("serves a later ask from the cache", async () => {
    await installedContent({ paths: ["/x"] });
    await installedContent({ paths: ["/x"] });
    expect(dlInstalledContent).toHaveBeenCalledTimes(1);
  });

  it("treats a different path order as the same entry", async () => {
    await installedContent({ paths: ["/x", "/y"] });
    await installedContent({ paths: ["/y", "/x"] });
    expect(dlInstalledContent).toHaveBeenCalledTimes(1);
  });

  it("keeps a different set of paths apart", async () => {
    await installedContent({ paths: ["/x"] });
    await installedContent({ paths: ["/x", "/y"] });
    expect(dlInstalledContent).toHaveBeenCalledTimes(2);
  });

  it("does not remember a rejection", async () => {
    dlInstalledContent.mockRejectedValueOnce(new Error("disk"));
    await expect(installedContent({ paths: ["/x"] })).rejects.toThrow("disk");
    await expect(installedContent({ paths: ["/x"] })).resolves.toBe(listing);
    expect(dlInstalledContent).toHaveBeenCalledTimes(2);
  });

  it("reads again after an invalidation", async () => {
    await installedContent({ paths: ["/x"] });
    invalidateInstalledContent();
    await installedContent({ paths: ["/x"] });
    expect(dlInstalledContent).toHaveBeenCalledTimes(2);
  });

  it("does not store a read that an invalidation overtook", async () => {
    let finish: (v: typeof listing) => void = () => {};
    dlInstalledContent.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const stale = installedContent({ paths: ["/x"] });
    invalidateInstalledContent();
    finish(listing);
    await stale;
    await installedContent({ paths: ["/x"] });
    expect(dlInstalledContent).toHaveBeenCalledTimes(2);
  });
});
