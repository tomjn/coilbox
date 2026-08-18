import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  dlDownloadRaw,
  dlDownloadFileRaw,
  dlGithubReleaseArchives,
  dlSpringfilesList,
  loadGithubGameRepos,
  notify,
} = vi.hoisted(() => ({
  dlDownloadRaw: vi.fn(),
  dlDownloadFileRaw: vi.fn(),
  dlGithubReleaseArchives: vi.fn(),
  dlSpringfilesList: vi.fn(),
  loadGithubGameRepos: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("./bindings", () => ({
  dlDownloadRaw,
  dlDownloadFileRaw,
  dlGithubReleaseArchives,
  dlSpringfilesList,
}));
vi.mock("../content/branding", () => ({ loadGithubGameRepos }));
vi.mock("../notify/notify", () => ({ notify }));

import { downloadGameAnySource } from "./downloadGame";
import { DEFAULT_RAPID_MASTERS } from "./rapidMasters";

/** A game with no GitHub repo and no springfiles entry, so only rapid is tried. */
const BAR_GAME = "Beyond All Reason test-30922-8064a43";

const run = () =>
  downloadGameAnySource({
    gameName: BAR_GAME,
    writePath: "/data",
    // biome-ignore lint/suspicious/noExplicitAny: the channel is never read here
    onProgress: {} as any,
  });

beforeEach(() => {
  vi.clearAllMocks();
  loadGithubGameRepos.mockResolvedValue([]);
  dlSpringfilesList.mockResolvedValue({ results: [] });
});

describe("downloadGameAnySource, rapid step", () => {
  it("asks every configured master rather than stopping at the first", async () => {
    // pr-downloader only ever searches the master it is given, and games are
    // spread across several, so a walk that gives up after one loses whatever
    // the others publish. Written against however many masters ship, since the
    // list has been both one and two entries long.
    for (let i = 1; i < DEFAULT_RAPID_MASTERS.length; i++) {
      dlDownloadRaw.mockRejectedValueOnce(new Error("no source could provide"));
    }
    dlDownloadRaw.mockResolvedValueOnce({ message: "ok" });

    await expect(run()).resolves.toBe("rapid");

    expect(dlDownloadRaw).toHaveBeenCalledTimes(DEFAULT_RAPID_MASTERS.length);
    expect(dlDownloadRaw.mock.calls.map((c) => c[0].masterUrl)).toEqual(
      DEFAULT_RAPID_MASTERS.map((r) => r.url),
    );
    expect(dlDownloadRaw.mock.calls[0][0].tag).toBe(BAR_GAME);
  });

  it("stops at the first master that has the game", async () => {
    dlDownloadRaw.mockResolvedValueOnce({ message: "ok" });
    await expect(run()).resolves.toBe("rapid");
    expect(dlDownloadRaw).toHaveBeenCalledTimes(1);
  });

  it("reports every master it tried when none has the game", async () => {
    dlDownloadRaw.mockRejectedValue(new Error("no source could provide"));
    const err = await run().catch((e: Error) => e);
    for (const master of DEFAULT_RAPID_MASTERS) {
      expect(String(err)).toContain(master.name);
    }
    expect(dlDownloadRaw).toHaveBeenCalledTimes(DEFAULT_RAPID_MASTERS.length);
  });
});
