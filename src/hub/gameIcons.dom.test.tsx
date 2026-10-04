// @vitest-environment happy-dom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HubGame, HubResult } from "./api";

const hoisted = vi.hoisted(() => ({
  hub: "https://hub.example" as string | null,
  fetchHubGames: vi.fn(),
  /** What the cached image path hands back for a logo or banner. */
  local: undefined as string | undefined,
}));

vi.mock("./api", () => ({ fetchHubGames: hoisted.fetchHubGames }));
vi.mock("./config", () => ({ useTrustedHubUrl: () => hoisted.hub }));
vi.mock("./assets/tier", () => ({
  assetCdnBase: () => "https://assets.example/coilbox-assets/",
}));

// The icon reads the scan and the cached art, which need the app frame.
vi.mock("@/content/config", () => ({
  useScanTargetSelection: () => ({
    selected: { enginePath: "/e", rootPath: "/r" },
  }),
  useUnitsyncScan: () => ({
    data: {
      games: [
        {
          name: "Splinter Faction 0.1.86",
          info: { shortname: "sf", version: "0.1.86" },
        },
      ],
    },
  }),
  useUnitsyncGameHeaders: () => ({ headers: new Map() }),
}));
vi.mock("@/content/branding", () => ({
  resolveBranding: () => null,
  useBrandingCatalog: () => [],
  useBrandingImage: () => hoisted.local,
  // The cache hands back a local file for any address it is given.
  useCachedImage: (urls?: string[]) =>
    urls?.length ? `cache://${urls[0]}` : undefined,
}));

import { GameIcon } from "@/components/GameIcon";
import { loadHubGames, resetHubGames, useHubGames } from "./gameIcons";

const SF_LOGO = "https://assets.example/coilbox-assets/games/SF/logo.png";

function hubGame(shortname: string, logo: string | null): HubGame {
  return {
    shortname,
    title: shortname,
    description: null,
    featured: false,
    downloads: [],
    logo,
    card: null,
    faction_count: 0,
    unit_count: 0,
    item_count: 0,
  };
}

function answer(games: HubGame[]): Promise<HubResult<HubGame[]>> {
  return Promise.resolve({ ok: true, value: games });
}

const icon = () => screen.getByTestId("game-icon");
const img = () => icon().querySelector("img");

beforeEach(() => {
  resetHubGames();
  hoisted.hub = "https://hub.example";
  hoisted.local = undefined;
  hoisted.fetchHubGames.mockReset();
});
afterEach(cleanup);

describe("hub game list", () => {
  it("makes no request when there is no trusted hub", async () => {
    hoisted.hub = null;
    hoisted.local = "cache://local-art.png";
    render(<GameIcon name="Splinter Faction 0.1.86" />);
    await act(async () => {});
    expect(hoisted.fetchHubGames).not.toHaveBeenCalled();
    expect(img()?.getAttribute("src")).toBe("cache://local-art.png");
  });

  it("makes one request for two consumers, and none on a later visit", async () => {
    hoisted.fetchHubGames.mockImplementation(() =>
      answer([hubGame("SF", SF_LOGO)]),
    );
    const first = render(
      <>
        <GameIcon name="Splinter Faction 0.1.86" />
        <GameIcon name="Splinter Faction" />
      </>,
    );
    await act(async () => {});
    expect(hoisted.fetchHubGames).toHaveBeenCalledTimes(1);
    expect(hoisted.fetchHubGames).toHaveBeenCalledWith("https://hub.example");
    first.unmount();

    render(<GameIcon name="Splinter Faction" />);
    await act(async () => {});
    expect(hoisted.fetchHubGames).toHaveBeenCalledTimes(1);
  });

  it("shows the hub's logo ahead of the local art, through the image cache", async () => {
    hoisted.local = "cache://local-art.png";
    hoisted.fetchHubGames.mockImplementation(() =>
      answer([hubGame("SF", SF_LOGO)]),
    );
    render(<GameIcon name="Splinter Faction 0.1.86" />);
    await act(async () => {});
    expect(img()?.getAttribute("src")).toBe(`cache://${SF_LOGO}`);
  });

  it("shows a returning visit's hub logo on the first render, with no swap", async () => {
    hoisted.local = "cache://local-art.png";
    hoisted.fetchHubGames.mockImplementation(() =>
      answer([hubGame("SF", SF_LOGO)]),
    );
    const first = render(<GameIcon name="Splinter Faction" />);
    await act(async () => {});
    first.unmount();

    render(<GameIcon name="Splinter Faction" />);
    expect(img()?.getAttribute("src")).toBe(`cache://${SF_LOGO}`);
  });

  it("leaves the local icon when the read fails, and does not ask again", async () => {
    hoisted.local = "cache://local-art.png";
    hoisted.fetchHubGames.mockImplementation(() =>
      Promise.resolve({ ok: false, reason: "down" }),
    );
    const first = render(<GameIcon name="Splinter Faction" />);
    await act(async () => {});
    expect(img()?.getAttribute("src")).toBe("cache://local-art.png");
    first.unmount();

    render(<GameIcon name="Splinter Faction" />);
    await act(async () => {});
    expect(img()?.getAttribute("src")).toBe("cache://local-art.png");
    expect(hoisted.fetchHubGames).toHaveBeenCalledTimes(1);
  });

  it("leaves the local icon when the read throws", async () => {
    hoisted.local = "cache://local-art.png";
    hoisted.fetchHubGames.mockImplementation(() =>
      Promise.reject(new Error("boom")),
    );
    render(<GameIcon name="Splinter Faction" />);
    await act(async () => {});
    expect(img()?.getAttribute("src")).toBe("cache://local-art.png");
  });

  it("draws the local icon at once while a slow read is still out", async () => {
    hoisted.local = "cache://local-art.png";
    hoisted.fetchHubGames.mockImplementation(() => new Promise(() => {}));
    render(<GameIcon name="Splinter Faction" />);
    expect(img()?.getAttribute("src")).toBe("cache://local-art.png");
    await act(async () => {});
    expect(img()?.getAttribute("src")).toBe("cache://local-art.png");
  });

  it("ignores a logo that points at another host", async () => {
    hoisted.local = "cache://local-art.png";
    hoisted.fetchHubGames.mockImplementation(() =>
      answer([hubGame("SF", "//other.example/logo.png")]),
    );
    render(<GameIcon name="Splinter Faction" />);
    await act(async () => {});
    expect(img()?.getAttribute("src")).toBe("cache://local-art.png");
  });

  it("asks the hub once however many callers load the list directly", async () => {
    hoisted.fetchHubGames.mockImplementation(() => answer([]));
    await Promise.all([
      loadHubGames("https://hub.example"),
      loadHubGames("https://hub.example"),
    ]);
    expect(hoisted.fetchHubGames).toHaveBeenCalledTimes(1);
  });

  it("asks each hub once", async () => {
    hoisted.fetchHubGames.mockImplementation(() => answer([]));
    await loadHubGames("https://hub.example");
    await loadHubGames("https://other-hub.example");
    expect(hoisted.fetchHubGames).toHaveBeenCalledTimes(2);
  });
});

describe("useHubGames", () => {
  function Probe() {
    const games = useHubGames();
    return <span data-testid="probe">{games ? games.length : "none"}</span>;
  }

  it("is null with no trusted hub", async () => {
    hoisted.hub = null;
    render(<Probe />);
    await act(async () => {});
    expect(screen.getByTestId("probe").textContent).toBe("none");
    expect(hoisted.fetchHubGames).not.toHaveBeenCalled();
  });
});
