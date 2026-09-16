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
// The real `Channel` registers its callback against the internals Tauri injects
// into a webview, and there is no webview here. What these tests read off a
// channel is which object it is and what it delivers. How the real one behaves
// when two commands share it is pinned in Rust, by `channel_reuse_tests` in the
// downloads plugin.
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (sample: unknown) => void = () => {};
  },
}));

import type { DownloadProgress } from "./bindings";
import { downloadGameAnySource } from "./downloadGame";
import { DEFAULT_RAPID_MASTERS } from "./rapidMasters";

/** A game with no GitHub repo and no springfiles entry, so only rapid is tried. */
const BAR_GAME = "Beyond All Reason test-30922-8064a43";

const run = () =>
  downloadGameAnySource({
    gameName: BAR_GAME,
    writePath: "/data",
    onProgress: () => {},
  });

beforeEach(() => {
  vi.clearAllMocks();
  loadGithubGameRepos.mockResolvedValue([]);
  dlSpringfilesList.mockResolvedValue({ results: [] });
});

describe("downloadGameAnySource, github step", () => {
  it("downloads the exact requested version's archive, not the newest release (issue #2731)", async () => {
    // Metal Factions' real release archives are named with a hyphen before the
    // version ("metalfactions-v2.40.sdz"), while the battle advertises the game
    // as space-separated ("Metal Factions v2.40"). Before the fix, the exact
    // match never fired for any version and this fell back to `archives[0]`,
    // the newest release, silently installing the wrong version every time.
    dlGithubReleaseArchives.mockResolvedValueOnce({
      archives: [
        {
          filename: "metalfactions-v2.58.sdz",
          url: "https://example.com/v2.58",
          size: 1,
          tag: "v2.58",
        },
        {
          filename: "metalfactions-v2.40.sdz",
          url: "https://example.com/v2.40",
          size: 1,
          tag: "v2.40",
        },
      ],
    });
    dlDownloadFileRaw.mockResolvedValueOnce({
      message: "ok",
      path: "/data/games/metalfactions-v2.40.sdz",
    });

    await expect(
      downloadGameAnySource({
        gameName: "Metal Factions v2.40",
        writePath: "/data",
        onProgress: () => {},
      }),
    ).resolves.toBe("github release");

    expect(dlDownloadFileRaw).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "metalfactions-v2.40.sdz" }),
    );
  });
});

describe("downloadGameAnySource, progress across sources", () => {
  /** A channel a command has returned from is closed, and a send on it is lost
   * without a word. Both fakes below behave that way, which is what makes these
   * tests say anything about issue #2861. */
  const closed = new WeakSet<object>();
  type Fake = { onProgress: { onmessage: (p: DownloadProgress) => void } };

  const sample = (percent: number): DownloadProgress => ({
    phase: percent === 100 ? "done" : "downloading",
    downloadedBytes: percent * 10,
    totalBytes: 1000,
    percent,
    bytesPerSec: null,
  });

  const send = (args: Fake, percent: number) => {
    if (!closed.has(args.onProgress))
      args.onProgress.onmessage(sample(percent));
  };

  it("reports a later source's progress rather than losing it down the failed one's channel (issue #2861)", async () => {
    // What a joiner saw: the bar stopped at 4 percent and stayed there while the
    // download carried on to the end, then said it was complete.
    dlGithubReleaseArchives.mockResolvedValueOnce({
      archives: [
        {
          filename: "metalfactions-v2.40.sdz",
          url: "https://example.com/v2.40",
          size: 1,
          tag: "v2.40",
        },
      ],
    });
    dlDownloadFileRaw.mockImplementationOnce(async (args: Fake) => {
      send(args, 4);
      closed.add(args.onProgress);
      throw new Error("connection reset");
    });
    dlSpringfilesList.mockResolvedValueOnce({
      results: [
        {
          springname: "Metal Factions v2.40",
          name: "Metal Factions v2.40",
          filename: "metalfactions-v2.40.sdz",
          category: "game",
          size: 1,
          mirrors: ["https://mirror.example.com/v2.40"],
          mapimages: [],
          metadata: { author: "", width: 0, height: 0 },
        },
      ],
    });
    dlDownloadFileRaw.mockImplementationOnce(async (args: Fake) => {
      send(args, 50);
      send(args, 100);
      closed.add(args.onProgress);
      return { message: "ok", path: "/data/games/metalfactions-v2.40.sdz" };
    });

    const seen: (number | null)[] = [];
    await expect(
      downloadGameAnySource({
        gameName: "Metal Factions v2.40",
        writePath: "/data",
        onProgress: (p) => seen.push(p?.percent ?? null),
      }),
    ).resolves.toBe("springfiles mirror");

    // The nulls are each source starting: the one before it got no further than
    // 4 percent, and carrying that over is what made a finished download look
    // like a stalled one.
    expect(seen).toEqual([null, 4, null, 50, 100]);

    const channels = dlDownloadFileRaw.mock.calls.map((c) => c[0].onProgress);
    expect(channels[0]).not.toBe(channels[1]);
  });
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
