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

const run = (mapName: string) =>
  downloadMapAnySource({
    mapName,
    writePath: "/data",
    onProgress: () => {},
  });

beforeEach(() => {
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

describe("downloadMapAnySource, no source has the map", () => {
  it("reports every attempted source's error rather than installing something else", async () => {
    dlDownloadMapRaw.mockRejectedValue(new Error("no source could provide"));

    const err = await run("Nonexistent Map").catch((e: Error) => e);

    expect(String(err)).toContain("Nonexistent Map");
    expect(String(err)).toContain("no source could provide");
    expect(dlDownloadFileRaw).not.toHaveBeenCalled();
  });
});
