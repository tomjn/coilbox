import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkHubDownload,
  dlDownloadFileRaw,
  dlDownloadMapRaw,
  dlEvolutionRtsMaps,
  dlGithubReleaseArchives,
  dlHakoraMaps,
  dlSpringfilesList,
  knownMap,
  notify,
} = vi.hoisted(() => ({
  checkHubDownload: vi.fn(),
  dlDownloadFileRaw: vi.fn(),
  dlDownloadMapRaw: vi.fn(),
  dlEvolutionRtsMaps: vi.fn(),
  dlGithubReleaseArchives: vi.fn(),
  dlHakoraMaps: vi.fn(),
  dlSpringfilesList: vi.fn(),
  knownMap: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("./bindings", () => ({
  dlDownloadFileRaw,
  dlDownloadMapRaw,
  dlEvolutionRtsMaps,
  dlGithubReleaseArchives,
  dlHakoraMaps,
  dlSpringfilesList,
}));
vi.mock("../hub/maps/knownMaps", () => ({ knownMap }));
vi.mock("../notify/notify", () => ({ notify }));
vi.mock("./hubMismatch", () => ({ checkHubDownload }));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (sample: unknown) => void = () => {};
  },
}));

import type { HubFileDownload } from "../hub/api";
import { downloadMapAnySource } from "./downloadMap";
import { invalidateGithubReleases } from "./githubReleases";
import { setHubMapBase } from "./hubMapBase";
import { invalidateMirrorIndexes } from "./mirrorIndex";
import { SourceWalkError } from "./sourceWalk";

const MAP = "Isis 1.3";
const HUB = "https://hub.example";
const FILE = "isis_1.3.sd7";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const mirror = (host: string): HubFileDownload => ({
  kind: "url",
  value: `https://${host}/maps/${FILE}`,
  filename: FILE,
});
const author: HubFileDownload = { kind: "github", value: "someone/isis" };

/** The hub knowing the map, with these sources. */
const hubLists = (downloads: HubFileDownload[]) =>
  knownMap.mockResolvedValue({ slug: "isis", downloads });

const run = (extra: object = {}) => {
  const onAttempt = vi.fn();
  const result = downloadMapAnySource({
    mapName: MAP,
    writePath: "/data",
    onProgress: () => {},
    onAttempt,
    ...extra,
  });
  return { result, onAttempt };
};

/** The URLs `dlDownloadFileRaw` was asked for, in order. */
const fetched = () => dlDownloadFileRaw.mock.calls.map((c) => c[0].url);

beforeEach(() => {
  invalidateMirrorIndexes();
  invalidateGithubReleases();
  vi.clearAllMocks();
  setHubMapBase(HUB);
  knownMap.mockResolvedValue(null);
  dlDownloadFileRaw.mockResolvedValue({ message: "ok", path: "" });
  dlSpringfilesList.mockResolvedValue({
    results: [
      {
        springname: MAP,
        name: MAP,
        filename: FILE,
        category: "map",
        size: 1,
        mirrors: ["https://springfiles.example/isis_1.3.sd7"],
        mapimages: [],
        metadata: { author: "", width: 0, height: 0 },
      },
    ],
  });
  dlHakoraMaps.mockResolvedValue({ maps: [] });
  dlEvolutionRtsMaps.mockResolvedValue({ maps: [] });
});

describe("downloadMapAnySource, the hub's sources (issue #5251)", () => {
  it("fetches a hub url source before any known mirror", async () => {
    hubLists([mirror("m.example")]);

    const { result, onAttempt } = run();

    await expect(result).resolves.toBe("hub: m.example");
    expect(knownMap).toHaveBeenCalledWith(HUB, MAP);
    expect(dlDownloadFileRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `https://m.example/maps/${FILE}`,
        destDir: "/data/maps",
        filename: FILE,
      }),
    );
    expect(dlEvolutionRtsMaps).not.toHaveBeenCalled();
    expect(dlSpringfilesList).not.toHaveBeenCalled();
    expect(dlDownloadMapRaw).not.toHaveBeenCalled();
    expect(onAttempt.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({
        source: "url",
        outcome: "ok",
        mirror: "m.example",
        filename: FILE,
      }),
    ]);
  });

  it("fetches a github source from the release the hub's asset names", async () => {
    hubLists([{ ...author, asset: "ISIS" }]);
    dlGithubReleaseArchives.mockResolvedValue({
      archives: [
        { tag: "v2", filename: "other.sd7", url: "https://gh.example/other" },
        { tag: "v2", filename: "isis_1.3.sd7", url: "https://gh.example/isis" },
      ],
    });

    await expect(run().result).resolves.toBe("hub: someone/isis");

    expect(dlGithubReleaseArchives).toHaveBeenCalledWith({
      repo: "someone/isis",
    });
    expect(fetched()).toEqual(["https://gh.example/isis"]);
    expect(dlDownloadFileRaw).toHaveBeenCalledWith(
      expect.objectContaining({ destDir: "/data/maps", filename: FILE }),
    );
  });

  it("takes the newest archive of a github source that names no asset", async () => {
    hubLists([author]);
    dlGithubReleaseArchives.mockResolvedValue({
      archives: [
        { tag: "v3", filename: "isis_3.sd7", url: "https://gh.example/new" },
        { tag: "v2", filename: "isis_2.sd7", url: "https://gh.example/old" },
      ],
    });

    await run().result;

    expect(fetched()).toEqual(["https://gh.example/new"]);
  });

  it("tries the author's repository before a mirror the hub lists after it", async () => {
    hubLists([author, mirror("m.example")]);
    dlGithubReleaseArchives.mockResolvedValue({
      archives: [{ tag: "v1", filename: FILE, url: "https://gh.example/isis" }],
    });

    await run().result;

    expect(fetched()).toEqual(["https://gh.example/isis"]);
  });

  it("downloads a map the hub lists nothing for exactly as before", async () => {
    hubLists([]);

    const { result, onAttempt } = run();

    await expect(result).resolves.toBe("springfiles mirror");
    expect(fetched()).toEqual(["https://springfiles.example/isis_1.3.sd7"]);
    expect(dlGithubReleaseArchives).not.toHaveBeenCalled();
    expect(onAttempt).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ source: "springfiles", outcome: "ok" }),
    );
  });

  it("downloads a map the hub does not know exactly as before", async () => {
    knownMap.mockResolvedValue(null);

    await expect(run().result).resolves.toBe("springfiles mirror");
    expect(fetched()).toEqual(["https://springfiles.example/isis_1.3.sd7"]);
  });

  it("asks nobody when the hub is off", async () => {
    setHubMapBase(null);

    await expect(run().result).resolves.toBe("springfiles mirror");
    expect(knownMap).not.toHaveBeenCalled();
  });

  it("uses rapid alone, and does not ask the hub, with no write root", async () => {
    hubLists([mirror("m.example")]);
    dlDownloadMapRaw.mockResolvedValueOnce({ message: "ok" });

    await run({ writePath: undefined }).result;

    expect(knownMap).not.toHaveBeenCalled();
    expect(dlDownloadFileRaw).not.toHaveBeenCalled();
    expect(dlDownloadMapRaw).toHaveBeenCalledTimes(1);
  });

  it("moves to the hub's next source when one fails, then to the mirrors", async () => {
    hubLists([mirror("a.example"), mirror("b.example")]);
    dlDownloadFileRaw
      .mockRejectedValueOnce(
        new Error(`HTTP status client error (404 Not Found) for url (x)`),
      )
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce({ message: "ok", path: "" });

    const { result, onAttempt } = run();

    await expect(result).resolves.toBe("springfiles mirror");
    expect(fetched()).toEqual([
      `https://a.example/maps/${FILE}`,
      `https://b.example/maps/${FILE}`,
      "https://springfiles.example/isis_1.3.sd7",
    ]);
    expect(
      onAttempt.mock.calls.map((c) => [c[0].source, c[0].outcome]),
    ).toEqual([
      ["url", "failed"],
      ["url", "failed"],
      ["springfiles", "ok"],
    ]);
  });

  it("passes a mirror's hash to the file download, and installs when it matches", async () => {
    hubLists([{ ...mirror("a.example"), sha256: HASH_A }]);

    const { result, onAttempt } = run();

    await expect(result).resolves.toBe("hub: a.example");
    expect(dlDownloadFileRaw).toHaveBeenCalledTimes(1);
    expect(dlDownloadFileRaw).toHaveBeenCalledWith(
      expect.objectContaining({ sha256: HASH_A }),
    );
    expect(onAttempt.mock.calls.map((c) => c[0].outcome)).toEqual(["ok"]);
    expect(checkHubDownload).toHaveBeenCalledWith({
      sha256: HASH_A,
      destDir: "/data/maps",
      filename: FILE,
    });
  });

  it("downloads as before when the source lists no hash, and checks nothing", async () => {
    hubLists([mirror("a.example")]);

    await run().result;

    expect(dlDownloadFileRaw.mock.calls[0][0].sha256).toBeUndefined();
    expect(checkHubDownload).not.toHaveBeenCalled();
  });

  it("moves to the next source when a file does not match its hash", async () => {
    hubLists([
      { ...mirror("a.example"), sha256: HASH_A },
      { ...mirror("b.example"), sha256: HASH_A },
    ]);
    dlDownloadFileRaw
      .mockRejectedValueOnce(
        new Error(
          `Checksum mismatch for ${FILE}: expected ${HASH_A}, got ${HASH_B} (a.example)`,
        ),
      )
      .mockResolvedValueOnce({ message: "ok", path: "" });

    const { result, onAttempt } = run();

    await expect(result).resolves.toBe("hub: b.example");
    expect(fetched()).toEqual([
      `https://a.example/maps/${FILE}`,
      `https://b.example/maps/${FILE}`,
    ]);
    expect(
      onAttempt.mock.calls.map((c) => [c[0].mirror, c[0].outcome]),
    ).toEqual([
      ["a.example", "failed"],
      ["b.example", "ok"],
    ]);
    // Only the file that matched is checked. The mismatched one is the
    // mirror's fault and is never reported to the hub (issue #5267).
    expect(checkHubDownload).toHaveBeenCalledTimes(1);
  });

  it("checks nothing for a github source, which carries no hash", async () => {
    hubLists([author]);
    dlGithubReleaseArchives.mockResolvedValue({
      archives: [
        { tag: "v1", filename: "isis.sd7", url: "https://gh.example/isis.sd7" },
      ],
    });

    await run().result;

    expect(checkHubDownload).not.toHaveBeenCalled();
  });

  it("falls to the mirrors when a github source has nothing to fetch", async () => {
    hubLists([author]);
    dlGithubReleaseArchives.mockResolvedValue({ archives: [] });

    const { result, onAttempt } = run();

    await expect(result).resolves.toBe("springfiles mirror");
    expect(onAttempt.mock.calls[0][0]).toEqual(
      expect.objectContaining({ source: "github", outcome: "failed" }),
    );
  });

  it("reaches rapid when the hub's sources and every mirror fail", async () => {
    hubLists([mirror("a.example")]);
    dlDownloadFileRaw.mockRejectedValue(new Error("connection reset"));
    dlDownloadMapRaw.mockResolvedValueOnce({ message: "ok" });

    await expect(run().result).resolves.toBe("springfiles (pr-downloader)");
  });

  it("stops at a cancel and offers the hub's next source for a retry", async () => {
    hubLists([mirror("a.example"), mirror("b.example")]);
    dlDownloadFileRaw.mockRejectedValueOnce(new Error("download cancelled"));

    const error = await run().result.catch((e) => e);

    expect(error).toBeInstanceOf(SourceWalkError);
    expect(error.next).toEqual({ source: "url", mirror: "b.example" });
    expect(dlDownloadFileRaw).toHaveBeenCalledTimes(1);
  });

  it("offers the first known mirror after a cancel on the hub's last source", async () => {
    hubLists([mirror("a.example")]);
    dlDownloadFileRaw.mockRejectedValueOnce(new Error("download cancelled"));

    const error = await run().result.catch((e) => e);

    expect(error.next).toEqual({ source: "evolutionrts", mirror: null });
  });

  it("starts a retry at the hub source it names", async () => {
    hubLists([mirror("a.example"), mirror("b.example")]);

    await run({ startAt: { source: "url", mirror: "b.example" } }).result;

    expect(fetched()).toEqual([`https://b.example/maps/${FILE}`]);
  });

  it("skips the hub on a retry that starts at a known mirror", async () => {
    hubLists([mirror("a.example")]);

    await run({ startAt: { source: "springfiles", mirror: null } }).result;

    expect(fetched()).toEqual(["https://springfiles.example/isis_1.3.sd7"]);
  });
});
