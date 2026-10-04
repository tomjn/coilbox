// @vitest-environment happy-dom
/**
 * Issue #3392: a scan whose unitsync `Init` failed comes back with empty lists.
 * The Games and Maps pages used to answer that with "No games yet, try one of
 * these", to somebody whose games were all still on disk. They now say the scan
 * failed and why.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const SELECTED = {
  enginePath: "/engines/105",
  rootPath: "/data",
  engineId: "105",
  engineVersion: "105",
};

const REASON = "Init: not enough free space on drive";

let mockScan: {
  maps: never[];
  games: never[];
  errors: string[];
  initFailure?: string;
} = { maps: [], games: [], errors: [] };

vi.mock("../config", () => ({
  useScanTargetSelection: () => ({
    targets: [SELECTED],
    selected: SELECTED,
    selectedKey: "k",
    setSelectedKey: () => {},
  }),
  useUnitsyncScan: () => ({
    data: mockScan,
    loading: false,
    error: null,
    cancelled: false,
    run: () => {},
    cancel: () => {},
  }),
  useUnitsyncGameHeaders: () => ({ headers: new Map(), loading: false }),
  useUnitsyncThumbnails: () => ({ thumbs: new Map(), loading: false }),
  useUnitsyncMapMeta: () => ({ meta: new Map() }),
}));
vi.mock("../branding", () => ({
  filterUninstalledGames: () => [{ name: "Some Game" }],
  filterUninstalledMaps: () => [{ name: "Some Map" }],
  useBrandingCatalog: () => [],
  useSuggestedGames: () => [],
  useSuggestedMaps: () => [],
}));
vi.mock("../usePlayGame", () => ({ usePlayGame: () => () => {} }));
vi.mock("../usePlayMap", () => ({ usePlayMap: () => () => {} }));
vi.mock("../../downloads/bindings", () => ({
  dlInstalledContent: async () => ({ games: [], maps: [] }),
}));
vi.mock("../../downloads/config", () => ({
  useContentRootPaths: () => [],
  useWriteRoot: () => null,
}));
vi.mock("./components/BrowserToolbar", () => ({
  BrowserToolbar: () => null,
}));
vi.mock("./components/SuggestionsList", () => ({
  SuggestionsList: ({ heading }: { heading: string }) => <p>{heading}</p>,
}));

import GamesPage from "./GamesPage";
import MapsPage from "./MapsPage";

afterEach(() => {
  cleanup();
  mockScan = { maps: [], games: [], errors: [] };
});

function renderPage(page: React.ReactNode) {
  return render(<MemoryRouter>{page}</MemoryRouter>);
}

describe("Games page empty state", () => {
  it("says the scan failed and why, and offers no downloads, when Init failed", () => {
    mockScan = { maps: [], games: [], errors: [REASON], initFailure: REASON };
    renderPage(<GamesPage />);
    expect(screen.getByText(/scan failed/i)).toBeTruthy();
    expect(screen.getAllByText(new RegExp(REASON)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No games yet/)).toBeNull();
    expect(screen.queryByText(/No games found/)).toBeNull();
  });

  it("still offers suggestions when a clean scan found no games", () => {
    renderPage(<GamesPage />);
    expect(screen.getByText(/No games yet/)).toBeTruthy();
    expect(screen.queryByText(/scan failed/i)).toBeNull();
  });
});

describe("Maps page empty state", () => {
  it("says the scan failed and why, and offers no downloads, when Init failed", () => {
    mockScan = { maps: [], games: [], errors: [REASON], initFailure: REASON };
    renderPage(<MapsPage />);
    expect(screen.getByText(/scan failed/i)).toBeTruthy();
    expect(screen.getAllByText(new RegExp(REASON)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No maps yet/)).toBeNull();
    expect(screen.queryByText(/No maps found/)).toBeNull();
  });

  it("still offers suggestions when a clean scan found no maps", () => {
    renderPage(<MapsPage />);
    expect(screen.getByText(/No maps yet/)).toBeTruthy();
    expect(screen.queryByText(/scan failed/i)).toBeNull();
  });
});
