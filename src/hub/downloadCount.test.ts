import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnqueueInput } from "../downloads/DownloadQueueProvider";
import { setHubMapBase } from "../downloads/hubMapBase";
import type { HubGame } from "./api";

// Same stubs as importCount.test.ts: the published picoframe dists use
// extensionless relative imports Vitest's node resolver won't load.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [true, () => {}],
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

const { counting, held } = vi.hoisted(() => ({
  counting: { on: true },
  held: { games: null as unknown as HubGame[] | null },
}));
vi.mock("@/profile/profile", () => ({
  isHubImportCountEnabled: () => counting.on,
}));
const { archiveShortname } = vi.hoisted(() => ({ archiveShortname: vi.fn() }));
vi.mock("../downloads/hubMismatch", () => ({
  gameShortnameFor: archiveShortname,
}));
vi.mock("./gameIcons", () => ({
  heldHubGames: () => held.games,
}));

import {
  gameDownloadedUrl,
  mapDownloadedUrl,
  reportDownload,
} from "./downloadCount";

const HUB = "https://hub.test";
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function hubGame(
  shortname: string,
  title: string,
  downloads: HubGame["downloads"],
): HubGame {
  return {
    shortname,
    title,
    description: null,
    featured: false,
    downloads,
    logo: null,
    card: null,
    faction_count: 0,
    unit_count: 0,
    item_count: 0,
  };
}

const BA = hubGame("BA", "Balanced Annihilation", [
  { kind: "rapid", value: "ba:stable" },
  { kind: "github", value: "example/ba", asset: ".sdz" },
]);
const ZK = hubGame("ZK", "Zero-K", [{ kind: "rapid", value: "zk:stable" }]);

describe("download URLs", () => {
  it("addresses the map route", () => {
    expect(mapDownloadedUrl(HUB)).toBe(
      "https://hub.test/api/v1/maps/downloaded",
    );
  });

  it("addresses the game route and encodes the shortname", () => {
    expect(gameDownloadedUrl(HUB, "BA")).toBe(
      "https://hub.test/api/v1/games/BA/downloaded",
    );
    expect(gameDownloadedUrl(HUB, "a/b")).toBe(
      "https://hub.test/api/v1/games/a%2Fb/downloaded",
    );
  });
});

describe("reportDownload", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    archiveShortname.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    setHubMapBase(HUB);
    counting.on = true;
    held.games = [BA, ZK];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setHubMapBase(null);
  });

  it("posts the map name for a map from any source", async () => {
    reportDownload({
      kind: "mapAnySource",
      label: "Isis",
      args: { mapName: "Isis 1.2" },
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hub.test/api/v1/maps/downloaded");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ name: "Isis 1.2" });
  });

  it("posts the map name for a catalog map", async () => {
    reportDownload({
      kind: "map",
      label: "Isis",
      args: { springName: "Isis 1.2" },
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: "Isis 1.2",
    });
  });

  it("posts a hub game to the shortname the request carries, with no list lookup", async () => {
    held.games = null;

    reportDownload({
      kind: "hubGame",
      label: "Balanced Annihilation",
      args: { downloads: BA.downloads, destDir: "/d/games", shortname: "BA" },
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hub.test/api/v1/games/BA/downloaded");
    expect(init).toEqual({ method: "POST" });
  });

  it("sends nothing for a hub game request that carries no shortname", async () => {
    reportDownload({
      kind: "hubGame",
      label: "Balanced Annihilation",
      args: { downloads: BA.downloads, destDir: "/d/games" },
    });
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a rapid download whose tag a hub game lists", async () => {
    reportDownload({
      kind: "rapid",
      label: "Zero-K",
      args: { tag: "zk:stable" },
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://hub.test/api/v1/games/ZK/downloaded",
    );
  });

  describe("a game named by its archive", () => {
    const request = {
      kind: "game",
      label: "Splinter Faction",
      args: { gameName: "Splinter Faction 1.2" },
    } as const;

    it("posts to the shortname the catalogue lists for that exact archive", async () => {
      archiveShortname.mockResolvedValue("sf");

      reportDownload(request);
      await settle();

      expect(archiveShortname).toHaveBeenCalledWith(
        "https://hub.test",
        "Splinter Faction 1.2",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://hub.test/api/v1/games/sf/downloaded",
      );
    });

    it("sends nothing when the catalogue lists no such archive", async () => {
      archiveShortname.mockResolvedValue(undefined);

      reportDownload(request);
      await settle();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends nothing, and raises nothing, when the catalogue cannot be loaded", async () => {
      archiveShortname.mockRejectedValue(new Error("offline"));

      reportDownload(request);
      await settle();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("looks nothing up when counting is off", async () => {
      counting.on = false;

      reportDownload(request);
      await settle();

      expect(archiveShortname).not.toHaveBeenCalled();
    });
  });

  it("sends nothing for a game no hub game matches", async () => {
    reportDownload({
      kind: "rapid",
      label: "Other",
      args: { tag: "other:test" },
    });
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing for a game while the hub's list has not landed", async () => {
    held.games = null;

    reportDownload({
      kind: "rapid",
      label: "Zero-K",
      args: { tag: "zk:stable" },
    });
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing when two hub games would match", async () => {
    held.games = [ZK, hubGame("ZK2", "Zero-K Fork", ZK.downloads)];

    reportDownload({
      kind: "rapid",
      label: "Zero-K",
      args: { tag: "zk:stable" },
    });
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the map name carried by a file request", async () => {
    reportDownload({
      kind: "file",
      label: "Isis",
      args: {
        url: "https://example.test/isis.sd7",
        destDir: "/d/maps",
        filename: "isis.sd7",
        mapName: "Isis 1.2",
      },
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://hub.test/api/v1/maps/downloaded",
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: "Isis 1.2",
    });
  });

  it("sends nothing for a file request with no map name", async () => {
    reportDownload({
      kind: "file",
      label: "Isis",
      args: {
        url: "https://example.test/isis.sd7",
        destDir: "/d/maps",
        filename: "isis.sd7",
      },
    });
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing for an engine", async () => {
    const engines: EnqueueInput[] = [
      {
        kind: "engineRecoil",
        label: "Engine",
        args: {
          version: "1",
          assetUrl: "https://x.test/e.7z",
          writePath: "/d",
        },
      },
      { kind: "engineSpring", label: "Engine", args: { version: "1" } },
      {
        kind: "engineBundled",
        label: "Engine",
        args: { version: "1", writePath: "/d" },
      },
    ];
    for (const engine of engines) reportDownload(engine);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing when the distribution switched counting off", async () => {
    counting.on = false;

    reportDownload({
      kind: "mapAnySource",
      label: "Isis",
      args: { mapName: "Isis" },
    });
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing when there is no trusted hub", async () => {
    setHubMapBase(null);

    reportDownload({
      kind: "mapAnySource",
      label: "Isis",
      args: { mapName: "Isis" },
    });
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("raises nothing when the hub cannot be reached", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    expect(() =>
      reportDownload({
        kind: "mapAnySource",
        label: "Isis",
        args: { mapName: "Isis" },
      }),
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("raises nothing when fetch itself throws", async () => {
    fetchMock.mockImplementation(() => {
      throw new Error("no fetch");
    });

    expect(() =>
      reportDownload({
        kind: "mapAnySource",
        label: "Isis",
        args: { mapName: "Isis" },
      }),
    ).not.toThrow();
  });
});
