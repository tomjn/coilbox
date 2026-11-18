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
vi.mock("./gameIcons", () => ({
  heldHubGames: () => held.games,
}));

import {
  gameDownloadedUrl,
  mapDownloadedUrl,
  reportDownload,
} from "./downloadCount";

const HUB = "https://hub.test";

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

  it("posts the map name for a map from any source", () => {
    reportDownload({
      kind: "mapAnySource",
      label: "Isis",
      args: { mapName: "Isis 1.2" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hub.test/api/v1/maps/downloaded");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ name: "Isis 1.2" });
  });

  it("posts the map name for a catalog map", () => {
    reportDownload({
      kind: "map",
      label: "Isis",
      args: { springName: "Isis 1.2" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: "Isis 1.2",
    });
  });

  it("posts a hub game to its shortname, found by its download sources", () => {
    reportDownload({
      kind: "hubGame",
      label: "Balanced Annihilation",
      // The pinned source first: order must not matter.
      args: { downloads: [...BA.downloads].reverse(), destDir: "/d/games" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hub.test/api/v1/games/BA/downloaded");
    expect(init).toEqual({ method: "POST" });
  });

  it("posts a rapid download whose tag a hub game lists", () => {
    reportDownload({
      kind: "rapid",
      label: "Zero-K",
      args: { tag: "zk:stable" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://hub.test/api/v1/games/ZK/downloaded",
    );
  });

  it("posts a game archive whose name, less its version, is a hub game's title", () => {
    reportDownload({
      kind: "game",
      label: "Balanced Annihilation",
      args: { gameName: "Balanced Annihilation V15.9.8" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://hub.test/api/v1/games/BA/downloaded",
    );
  });

  it("sends nothing for a game no hub game matches", () => {
    reportDownload({
      kind: "game",
      label: "Remix",
      args: { gameName: "Balanced Annihilation Remix V1.0" },
    });
    reportDownload({
      kind: "rapid",
      label: "Other",
      args: { tag: "other:test" },
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing for a game while the hub's list has not landed", () => {
    held.games = null;

    reportDownload({
      kind: "rapid",
      label: "Zero-K",
      args: { tag: "zk:stable" },
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing when two hub games would match", () => {
    held.games = [ZK, hubGame("ZK2", "Zero-K Fork", ZK.downloads)];

    reportDownload({
      kind: "rapid",
      label: "Zero-K",
      args: { tag: "zk:stable" },
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing for a file, which names no map", () => {
    reportDownload({
      kind: "file",
      label: "Isis",
      args: {
        url: "https://example.test/isis.sd7",
        destDir: "/d/maps",
        filename: "isis.sd7",
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing for an engine", () => {
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

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing when the distribution switched counting off", () => {
    counting.on = false;

    reportDownload({
      kind: "mapAnySource",
      label: "Isis",
      args: { mapName: "Isis" },
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing when there is no trusted hub", () => {
    setHubMapBase(null);

    reportDownload({
      kind: "mapAnySource",
      label: "Isis",
      args: { mapName: "Isis" },
    });

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
    await Promise.resolve();
  });

  it("raises nothing when fetch itself throws", () => {
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
