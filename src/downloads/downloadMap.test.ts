import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  dlDownloadFileRaw,
  dlDownloadMapRaw,
  dlEvolutionRtsMaps,
  dlHakoraMaps,
  dlSpringfilesList,
  notify,
} = vi.hoisted(() => ({
  dlDownloadFileRaw: vi.fn(),
  dlDownloadMapRaw: vi.fn(),
  dlEvolutionRtsMaps: vi.fn(),
  dlHakoraMaps: vi.fn(),
  dlSpringfilesList: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("./bindings", () => ({
  dlDownloadFileRaw,
  dlDownloadMapRaw,
  dlEvolutionRtsMaps,
  dlHakoraMaps,
  dlSpringfilesList,
}));
vi.mock("../notify/notify", () => ({ notify }));
// progressChannel builds a real Channel, which needs the Tauri webview. The
// same stand-in downloadGame.test.ts uses.
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (sample: unknown) => void = () => {};
  },
}));

import { downloadMapAnySource } from "./downloadMap";
import { indexTick, invalidateMirrorIndexes } from "./mirrorIndex";
import { SourceWalkError } from "./sourceWalk";

const run = (mapName: string) =>
  downloadMapAnySource({
    mapName,
    writePath: "/data",
    onProgress: () => {},
  });

beforeEach(() => {
  invalidateMirrorIndexes();
  vi.clearAllMocks();
  dlSpringfilesList.mockResolvedValue({ results: [] });
  dlHakoraMaps.mockResolvedValue({ maps: [] });
  dlEvolutionRtsMaps.mockResolvedValue({ maps: [] });
});

describe("downloadMapAnySource, evolutionrts step", () => {
  it("fetches from evolutionrts before asking any other source", async () => {
    dlEvolutionRtsMaps.mockResolvedValueOnce({
      maps: [
        {
          filename: "acidicquarry_5.17.sd7",
          url: "https://maps.evolutionrts.info/maps/acidicquarry_5.17.sd7",
          size: 50602762,
        },
      ],
    });
    dlDownloadFileRaw.mockResolvedValueOnce({
      message: "ok",
      path: "/data/maps/acidicquarry_5.17.sd7",
    });

    await expect(run("Acidic Quarry 5.17")).resolves.toBe(
      "evolutionrts mirror",
    );

    expect(dlDownloadFileRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://maps.evolutionrts.info/maps/acidicquarry_5.17.sd7",
        destDir: "/data/maps",
        filename: "acidicquarry_5.17.sd7",
      }),
    );
    expect(dlSpringfilesList).not.toHaveBeenCalled();
    expect(dlHakoraMaps).not.toHaveBeenCalled();
    expect(dlDownloadMapRaw).not.toHaveBeenCalled();
  });
});

describe("downloadMapAnySource, hakora step (issue #2860)", () => {
  it("matches a hakora filename with a hyphen before the version, the same bug fixed in gameRepos.ts's norm (issue #2731)", async () => {
    // downloadMap.ts used to keep its own copy of norm() that stripped spaces
    // and underscores but not hyphens, so a mirror filename styled
    // "Word-Word-vX.Y" never matched. Now it imports the shared norm() from
    // gameRepos.ts, which does strip the hyphen.
    dlHakoraMaps.mockResolvedValueOnce({
      maps: [
        {
          filename: "some-map-v2.sdz",
          url: "https://example.com/some-map-v2.sdz",
          size: "1M",
        },
      ],
    });
    dlDownloadFileRaw.mockResolvedValueOnce({
      message: "ok",
      path: "/data/maps/some-map-v2.sdz",
    });

    await expect(run("Some Map v2")).resolves.toBe("hakora");

    expect(dlDownloadFileRaw).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "some-map-v2.sdz" }),
    );
  });
});

describe("downloadMapAnySource, attempts reported (issue #4576)", () => {
  it("reports the source, file and host of a map that arrived", async () => {
    dlHakoraMaps.mockResolvedValueOnce({
      maps: [
        {
          filename: "some-map-v2.sdz",
          url: "https://example.com/some-map-v2.sdz",
          size: "1M",
        },
      ],
    });
    dlDownloadFileRaw.mockResolvedValueOnce({ message: "ok", path: "" });
    const onAttempt = vi.fn();

    await downloadMapAnySource({
      mapName: "Some Map v2",
      writePath: "/data",
      onProgress: () => {},
      onAttempt,
    });

    expect(onAttempt).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "hakora",
        outcome: "ok",
        reference: "https://example.com/some-map-v2.sdz",
        filename: "some-map-v2.sdz",
        mirror: "example.com",
        failure: null,
      }),
    );
  });

  it("reports the pr-downloader step's failure although it handles the error itself", async () => {
    dlDownloadMapRaw.mockRejectedValue(new Error("no source could provide"));
    const onAttempt = vi.fn();

    await downloadMapAnySource({
      mapName: "Nonexistent Map",
      writePath: "/data",
      onProgress: () => {},
      onAttempt,
    }).catch(() => {});

    expect(onAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "springfiles",
        outcome: "failed",
        failure: "no source could provide",
      }),
    );
  });
});

describe("downloadMapAnySource, every springfiles mirror (issue #4577)", () => {
  const FILE = "Supreme_Isthmus_v2.sd7";
  const MIRROR_1 = `https://mirror1.example.com/${FILE}`;
  const MIRROR_2 = `https://mirror2.example.com/${FILE}`;
  const listOn = (mirrors: string[]) =>
    dlSpringfilesList.mockResolvedValue({
      results: [
        {
          springname: "Supreme Isthmus v2",
          name: "Supreme Isthmus v2",
          filename: FILE,
          category: "map",
          size: 1,
          mirrors,
          mapimages: [],
          metadata: { author: "", width: 0, height: 0 },
        },
      ],
    });
  const notFound = (host: string) =>
    new Error(
      `HTTP status client error (404 Not Found) for url (https://${host}/${FILE})`,
    );
  const go = (extra: object = {}) => {
    const onAttempt = vi.fn();
    const result = downloadMapAnySource({
      mapName: "Supreme Isthmus v2",
      writePath: "/data",
      onProgress: () => {},
      onAttempt,
      ...extra,
    });
    return { result, onAttempt };
  };

  it("fetches the second mirror when the first fails, and records both attempts", async () => {
    listOn([MIRROR_1, MIRROR_2]);
    dlDownloadFileRaw
      .mockRejectedValueOnce(notFound("mirror1.example.com"))
      .mockResolvedValueOnce({ message: "ok", path: "" });

    const { result, onAttempt } = go();

    await expect(result).resolves.toBe("springfiles mirror");
    expect(dlDownloadFileRaw.mock.calls.map((c) => c[0].url)).toEqual([
      MIRROR_1,
      MIRROR_2,
    ]);
    expect(dlDownloadMapRaw).not.toHaveBeenCalled();
    expect(onAttempt.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({
        source: "springfiles",
        outcome: "failed",
        mirror: "mirror1.example.com",
        filename: FILE,
        failure: `mirror1.example.com answered 404 for ${FILE}`,
      }),
      expect.objectContaining({
        source: "springfiles",
        outcome: "ok",
        mirror: "mirror2.example.com",
        failure: null,
      }),
    ]);
  });

  it("keeps the raw error text beside the plain reason", async () => {
    listOn([MIRROR_1, MIRROR_2]);
    dlDownloadFileRaw
      .mockRejectedValueOnce(notFound("mirror1.example.com"))
      .mockResolvedValueOnce({ message: "ok", path: "" });

    const { result, onAttempt } = go();
    await result;

    expect(onAttempt.mock.calls[0][0].detail).toContain("404 Not Found");
  });

  it("tries every mirror before the next kind of source", async () => {
    listOn([MIRROR_1, MIRROR_2]);
    dlDownloadFileRaw.mockRejectedValue(notFound("mirror.example.com"));
    dlDownloadMapRaw.mockRejectedValue(new Error("no source could provide"));

    const { result } = go();
    const err = await result.catch((e: Error) => e);

    expect(dlDownloadFileRaw).toHaveBeenCalledTimes(2);
    expect(dlDownloadMapRaw).toHaveBeenCalledTimes(1);
    expect(String(err)).toContain(
      `mirror1.example.com answered 404 for ${FILE}`,
    );
    expect(String(err)).not.toContain("HTTP status client error");
  });

  it("names the host for a timeout and for a stall", async () => {
    listOn([MIRROR_1, MIRROR_2]);
    dlDownloadFileRaw
      .mockRejectedValueOnce(new Error("The host took too long to respond."))
      .mockRejectedValueOnce(
        new Error(
          "Download stalled — no data received for 2 minutes. Check your connection or try a different mirror, then retry.",
        ),
      );
    dlDownloadMapRaw.mockRejectedValue(new Error("no source could provide"));

    const { result, onAttempt } = go();
    await result.catch(() => {});

    const failures = onAttempt.mock.calls
      .map((c) => c[0])
      .filter((a) => a.mirror?.startsWith("mirror"))
      .map((a) => a.failure);
    expect(failures).toEqual([
      `mirror1.example.com did not answer in time for ${FILE}`,
      `mirror2.example.com stopped sending ${FILE} for 2 minutes`,
    ]);
  });

  it("stops at a cancel and offers the mirror it had not reached", async () => {
    listOn([MIRROR_1, MIRROR_2]);
    dlDownloadFileRaw.mockRejectedValueOnce(new Error("Download cancelled."));

    const { result } = go();
    const err = await result.catch((e: unknown) => e);

    expect(dlDownloadFileRaw).toHaveBeenCalledTimes(1);
    expect(dlDownloadMapRaw).not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(SourceWalkError);
    expect((err as SourceWalkError).next).toEqual({
      source: "springfiles",
      mirror: "mirror2.example.com",
    });
    expect(String(err)).toMatch(/cancel/i);
  });

  it("offers the next kind of source when a cancel lands on the last mirror", async () => {
    listOn([MIRROR_1]);
    dlDownloadFileRaw.mockRejectedValueOnce(new Error("Download cancelled."));

    const err = await go().result.catch((e: unknown) => e);

    expect((err as SourceWalkError).next).toEqual({
      source: "hakora",
      mirror: null,
    });
  });

  it("offers nothing when every source failed", async () => {
    listOn([MIRROR_1]);
    dlDownloadFileRaw.mockRejectedValue(notFound("mirror1.example.com"));
    dlDownloadMapRaw.mockRejectedValue(new Error("no source could provide"));

    const err = await go().result.catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SourceWalkError);
    expect((err as SourceWalkError).next).toBeNull();
  });

  it("starts at the mirror it is told to, skipping the ones before it", async () => {
    listOn([MIRROR_1, MIRROR_2]);
    dlDownloadFileRaw.mockResolvedValueOnce({ message: "ok", path: "" });

    const { result } = go({
      startAt: { source: "springfiles", mirror: "mirror2.example.com" },
    });

    await expect(result).resolves.toBe("springfiles mirror");
    expect(dlDownloadFileRaw.mock.calls.map((c) => c[0].url)).toEqual([
      MIRROR_2,
    ]);
  });

  it("starts at a later kind of source, skipping the ones before it", async () => {
    listOn([MIRROR_1]);
    dlHakoraMaps.mockResolvedValue({
      maps: [
        { filename: FILE, url: `https://hakora.test/${FILE}`, size: "1M" },
      ],
    });
    dlDownloadFileRaw.mockResolvedValueOnce({ message: "ok", path: "" });

    const { result } = go({ startAt: { source: "hakora", mirror: null } });

    await expect(result).resolves.toBe("hakora");
    expect(dlDownloadFileRaw.mock.calls[0][0].url).toBe(
      `https://hakora.test/${FILE}`,
    );
  });
});

describe("downloadMapAnySource, no source has the map", () => {
  it("reports every attempted source's error rather than installing something else", async () => {
    dlDownloadMapRaw.mockRejectedValue(new Error("no source could provide"));

    const err = await run("Nonexistent Map").catch((e: Error) => e);

    expect(String(err)).toContain("Nonexistent Map");
    expect(String(err)).toContain("no source could provide");
    expect(dlDownloadFileRaw).not.toHaveBeenCalled();
  });
});

describe("downloadMapAnySource, mirror index reuse (issue #3717)", () => {
  const hakoraMap = (filename: string) => ({
    filename,
    url: `https://example.com/${filename}`,
    size: "1M",
  });

  it("fetches the mirror index once for a pack of maps", async () => {
    dlHakoraMaps.mockResolvedValue({
      maps: ["a.sd7", "b.sd7", "c.sd7"].map(hakoraMap),
    });
    dlDownloadFileRaw.mockResolvedValue({ message: "ok", path: "" });

    for (const name of ["a", "b", "c"]) {
      await expect(run(name)).resolves.toBe("hakora");
    }

    expect(dlHakoraMaps).toHaveBeenCalledTimes(1);
    expect(dlEvolutionRtsMaps).toHaveBeenCalledTimes(3);
  });

  it("refetches an index once for a map added since, then finds it", async () => {
    // Held from an earlier download.
    await expect(run("late")).rejects.toThrow();
    dlHakoraMaps.mockClear();
    dlHakoraMaps.mockResolvedValue({ maps: [hakoraMap("late.sd7")] });
    dlDownloadFileRaw.mockResolvedValue({ message: "ok", path: "" });

    await expect(run("late")).resolves.toBe("hakora");

    expect(dlHakoraMaps).toHaveBeenCalledTimes(1);
  });

  it("refetches once for a pack of missing maps queued together", async () => {
    await run("warm").catch(() => {});
    dlHakoraMaps.mockClear();
    dlSpringfilesList.mockClear();
    const askedAt = indexTick();

    for (const name of ["x", "y", "z"]) {
      await downloadMapAnySource({
        mapName: name,
        writePath: "/data",
        onProgress: () => {},
        askedAt,
      }).catch(() => {});
    }

    expect(dlHakoraMaps).toHaveBeenCalledTimes(1);
    expect(dlSpringfilesList).toHaveBeenCalledTimes(1);
  });
});
