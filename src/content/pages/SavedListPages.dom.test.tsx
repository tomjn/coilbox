// @vitest-environment happy-dom
/**
 * Issue #3715: the Maps and Games pages draw the last saved scan before the live
 * scan returns. While it is unchecked the list says so and no row can be played.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const SELECTED = {
  enginePath: "/engines/105",
  rootPath: "/data",
  engineId: "105",
  engineVersion: "105",
};

const SAVED = {
  maps: [
    { name: "Saved Map", archives: [{ name: "saved.sd7" }], info: {} },
    { name: "Gone Map", archives: [{ name: "gone.sd7" }], info: {} },
  ],
  games: [
    {
      name: "Saved Game",
      primaryArchive: { name: "saved_game.sdz" },
      archives: [],
      info: {},
    },
  ],
  errors: [],
};

interface MockHook {
  data: typeof SAVED | null;
  result: typeof SAVED | null;
  unchecked: boolean;
  status: "checking" | "checked" | "failed";
  error: string | null;
}

let mockHook: MockHook;

const unchecked = (status: "checking" | "failed", error: string | null) => {
  mockHook = { data: null, result: SAVED, unchecked: true, status, error };
};

vi.mock("../config", () => ({
  useScanTargetSelection: () => ({
    targets: [SELECTED],
    selected: SELECTED,
    selectedKey: "k",
    setSelectedKey: () => {},
  }),
  useUnitsyncGameHeaders: () => ({ headers: new Map(), loading: false }),
  useUnitsyncThumbnails: () => ({ thumbs: new Map(), loading: false }),
  useUnitsyncMapMeta: () => ({ meta: new Map() }),
}));
vi.mock("../lastKnownScan", () => ({
  useScanWithLastKnown: () => ({
    ...mockHook,
    unvouched: null,
    loading: mockHook.status === "checking",
    cancelled: false,
    run: () => {},
    cancel: () => {},
  }),
}));
vi.mock("../branding", () => ({
  filterUninstalledGames: () => [],
  filterUninstalledMaps: () => [],
  useBrandingCatalog: () => [],
  useGithubGameRepos: () => [],
  useBrandingEntry: () => undefined,
  useBrandingImage: () => undefined,
  useCachedImage: () => undefined,
  useSuggestedGames: () => [],
  useSuggestedMaps: () => [],
}));
vi.mock("../usePlayGame", () => ({ usePlayGame: () => () => {} }));
// The update sources read the download history and the rapid indexes.
const UPDATE_SOURCES = { catalogues: [], rapidVersions: {} };
vi.mock("../useUpdates", () => ({ useUpdateSources: () => UPDATE_SOURCES }));
vi.mock("../usePlayMap", () => ({ usePlayMap: () => () => {} }));
vi.mock("../../downloads/bindings", () => ({
  dlInstalledContent: async () => ({ games: [], maps: [] }),
}));
// The library also reads the download queue and the hub's games, and this
// page has neither.
vi.mock("../../downloads/DownloadQueueProvider", () => ({
  useDownloadQueue: () => ({ items: [], itemFor: () => null }),
  useDownloadComplete: () => {},
}));
vi.mock("../../hub/gameIcons", () => ({
  useHubGames: () => null,
  useHubGamesFailure: () => null,
}));
vi.mock("../../downloads/config", () => ({
  useContentRootPaths: () => [],
  useWriteRoot: () => null,
}));
// Every mirror index reads, and carries nothing.
vi.mock("../../downloads/mirrorIndex", () => ({
  loadSpringfilesList: async () => ({ results: [] }),
  loadHakoraMaps: async () => ({ maps: [] }),
  loadEvolutionRtsMaps: async () => ({ maps: [] }),
}));
vi.mock("../../downloads/githubReleases", () => ({
  loadGithubReleases: async () => [],
}));
// The Maps page asks the hub about the cards on screen and draws the map
// packs banner, both of which read the hub address from settings.
vi.mock("../../hub/maps/useMapFacts", () => ({
  useMapFactsBatch: () => ({ facts: new Map(), answered: true }),
}));
// Importing a setup pack from a deep link is the page's, not these tests'.
vi.mock("../../hub/imports", () => ({ useRecordHubImport: () => vi.fn() }));
vi.mock("@picoframe/frame", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@picoframe/frame")>()),
  useDrawer: () => ({ open: vi.fn(), close: vi.fn() }),
}));
vi.mock("../../downloads/pages/components/MapPacksBanner", () => ({
  MapPacksBanner: () => null,
}));
vi.mock("./components/BrowserToolbar", () => ({
  BrowserToolbar: () => null,
}));
vi.mock("./components/MapThumb", () => ({
  MapThumb: () => null,
  mapSizeLabel: () => "",
}));
vi.mock("./components/GameCard", () => ({
  GameCard: ({
    game,
    playDisabled,
  }: {
    game: { title: string };
    playDisabled?: boolean;
  }) => (
    <button type="button" disabled={playDisabled}>
      Play {game.title}
    </button>
  ),
}));

import GamesPage from "./GamesPage";
import MapsPage from "./MapsPage";

afterEach(cleanup);

function renderPage(page: React.ReactNode) {
  return render(<MemoryRouter>{page}</MemoryRouter>);
}

/** The Maps page says it is reading the mirror indexes until every read has
 *  settled. */
const mirrorsRead = () =>
  waitFor(() =>
    expect(screen.queryByText(/Reading the mirror indexes/)).toBeNull(),
  );

describe("Maps page with a saved scan", () => {
  it("lists the saved maps while the live scan runs, says it is checking, and cannot play them", async () => {
    unchecked("checking", null);
    renderPage(<MapsPage />);
    await mirrorsRead();
    expect(screen.getByText("Saved Map")).toBeTruthy();
    expect(screen.getByText("Gone Map")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Checking/);
    for (const play of screen.getAllByRole("button", { name: "Play" })) {
      expect((play as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("keeps the list and says it could not be checked when the scan failed", () => {
    unchecked("failed", "worker crashed");
    renderPage(<MapsPage />);
    expect(screen.getByText("Saved Map")).toBeTruthy();
    expect(screen.getByText(/could not be checked/i)).toBeTruthy();
    expect(screen.getByText(/worker crashed/)).toBeTruthy();
    for (const play of screen.getAllByRole("button", { name: "Play" })) {
      expect((play as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("enables play and shows no status once the live scan has answered", async () => {
    mockHook = {
      data: { ...SAVED, maps: [SAVED.maps[0]] },
      result: { ...SAVED, maps: [SAVED.maps[0]] },
      unchecked: false,
      status: "checked",
      error: null,
    };
    renderPage(<MapsPage />);
    await mirrorsRead();
    expect(screen.queryByText("Gone Map")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    const [play] = screen.getAllByRole("button", { name: "Play" });
    expect((play as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Games page with a saved scan", () => {
  it("lists the saved games while the live scan runs and cannot play them", () => {
    unchecked("checking", null);
    renderPage(<GamesPage />);
    const play = screen.getByRole("button", {
      name: "Play Saved Game",
    }) as HTMLButtonElement;
    expect(play.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/Checking/);
  });

  it("keeps the list and says it could not be checked when the scan failed", () => {
    unchecked("failed", "worker crashed");
    renderPage(<GamesPage />);
    expect(
      screen.getByRole("button", { name: "Play Saved Game" }),
    ).toBeTruthy();
    expect(screen.getByText(/could not be checked/i)).toBeTruthy();
  });

  it("enables play once the live scan has answered", () => {
    mockHook = {
      data: SAVED,
      result: SAVED,
      unchecked: false,
      status: "checked",
      error: null,
    };
    renderPage(<GamesPage />);
    const play = screen.getByRole("button", {
      name: "Play Saved Game",
    }) as HTMLButtonElement;
    expect(play.disabled).toBe(false);
  });
});
