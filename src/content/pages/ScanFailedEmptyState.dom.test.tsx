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

interface MockScan {
  maps: never[];
  games: never[];
  errors: string[];
  initFailure?: string;
}

const CLEAN: MockScan = { maps: [], games: [], errors: [] };
const FAILED: MockScan = {
  maps: [],
  games: [],
  errors: [REASON],
  initFailure: REASON,
};

// What the hook returns. A failed Init has no data and an error, and the raw
// result is held back in unvouched.
let mockHook: {
  data: MockScan | null;
  unvouched: MockScan | null;
  error: string | null;
} = { data: CLEAN, unvouched: null, error: null };

vi.mock("../config", () => ({
  useScanTargetSelection: () => ({
    targets: [SELECTED],
    selected: SELECTED,
    selectedKey: "k",
    setSelectedKey: () => {},
  }),
  useUnitsyncScan: () => ({
    data: mockHook.data,
    unvouched: mockHook.unvouched,
    loading: false,
    error: mockHook.error,
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
  mockHook = { data: CLEAN, unvouched: null, error: null };
});

function failScan() {
  mockHook = { data: null, unvouched: FAILED, error: REASON };
}

function renderPage(page: React.ReactNode) {
  return render(<MemoryRouter>{page}</MemoryRouter>);
}

describe("Games page empty state", () => {
  it("says the scan failed and why, and offers no downloads, when Init failed", () => {
    failScan();
    renderPage(<GamesPage />);
    expect(screen.getByText(/scan failed/i)).toBeTruthy();
    expect(screen.getAllByText(new RegExp(REASON)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No games yet/)).toBeNull();
    expect(screen.queryByText(/No games found/)).toBeNull();
  });

  it("shows the reason once, in the alert, not also in an error banner", () => {
    failScan();
    renderPage(<GamesPage />);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("still offers suggestions when a clean scan found no games", () => {
    renderPage(<GamesPage />);
    expect(screen.getByText(/No games yet/)).toBeTruthy();
    expect(screen.queryByText(/scan failed/i)).toBeNull();
  });
});

describe("Maps page empty state", () => {
  it("says the scan failed and why, and offers no downloads, when Init failed", () => {
    failScan();
    renderPage(<MapsPage />);
    expect(screen.getByText(/scan failed/i)).toBeTruthy();
    expect(screen.getAllByText(new RegExp(REASON)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No maps yet/)).toBeNull();
    expect(screen.queryByText(/No maps found/)).toBeNull();
  });

  it("shows the reason once, in the alert, not also in an error banner", () => {
    failScan();
    renderPage(<MapsPage />);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("shows an ordinary thrown error in the banner with no scan-failed alert", () => {
    mockHook = { data: null, unvouched: null, error: "worker crashed" };
    renderPage(<MapsPage />);
    expect(screen.getByText(/worker crashed/)).toBeTruthy();
    expect(screen.queryByText(/scan failed/i)).toBeNull();
  });

  it("still offers suggestions when a clean scan found no maps", () => {
    renderPage(<MapsPage />);
    expect(screen.getByText(/No maps yet/)).toBeTruthy();
    expect(screen.queryByText(/scan failed/i)).toBeNull();
  });
});
