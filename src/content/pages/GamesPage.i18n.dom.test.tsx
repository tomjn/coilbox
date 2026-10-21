// @vitest-environment happy-dom
/**
 * Issue #4601: the Library games page text comes out of the Lingui catalog. The
 * catalog here is a fixture, not a real translation. It renames the page title
 * so a translated string can be told from the English source.
 */
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIBRARY_GAMES_INPUT } from "../fixtures/libraryGames";
import { buildLibrary, type LibraryInput } from "../library";

const SELECTED = {
  enginePath: "/engines/105",
  rootPath: "/data",
  engineId: "105",
  engineVersion: "105",
};

const hoisted = vi.hoisted(() => ({
  input: null as LibraryInput | null,
  hubFailure: null as string | null,
  enqueue: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("../config", () => ({
  useScanTargetSelection: () => ({
    targets: [SELECTED],
    selected: SELECTED,
    selectedKey: "k",
    setSelectedKey: () => {},
  }),
  useUnitsyncGameHeaders: () => ({ headers: new Map(), loading: false }),
}));
vi.mock("../lastKnownScan", () => ({
  useScanWithLastKnown: () => ({
    data: hoisted.input?.scan,
    result: hoisted.input?.scan,
    unvouched: null,
    unchecked: false,
    status: "checked",
    loading: false,
    error: null,
    cancelled: false,
    run: () => {},
    cancel: () => {},
  }),
}));
vi.mock("../useLibrary", () => ({
  useLibrary: () => buildLibrary(hoisted.input as LibraryInput),
}));
vi.mock("../branding", () => ({
  filterUninstalledGames: () => [],
  useBrandingCatalog: () => [],
  useBrandingEntry: () => null,
  useBrandingImage: () => undefined,
  useCachedImage: () => undefined,
  useGithubGameRepos: () => [],
  useSuggestedGames: () => [],
}));
vi.mock("../usePlayGame", () => ({ usePlayGame: () => () => {} }));
// The update sources read the download history and the rapid indexes.
const UPDATE_SOURCES = { catalogues: [], rapidVersions: {} };
vi.mock("../useUpdates", () => ({ useUpdateSources: () => UPDATE_SOURCES }));
vi.mock("../../downloads/config", () => ({
  useWriteRoot: () => ({ path: "/data", loading: false }),
}));
vi.mock("../../downloads/DownloadQueueProvider", () => ({
  useDownloadQueue: () => ({
    enqueue: hoisted.enqueue,
    cancel: hoisted.cancel,
    itemFor: () => null,
  }),
}));
vi.mock("../../downloads/githubReleases", () => ({
  loadGithubReleases: async () => {
    throw new Error("no network in tests");
  },
}));
vi.mock("../../hub/gameIcons", async (original) => ({
  ...(await original<typeof import("../../hub/gameIcons")>()),
  useHubGames: () => [],
  useHubGamesFailure: () => hoisted.hubFailure,
}));
vi.mock("../../hub/config", () => ({ useTrustedHubUrl: () => null }));
vi.mock("./components/BrowserToolbar", () => ({
  BrowserToolbar: () => null,
  NoEngines: () => null,
  RescanButton: () => null,
}));

import GamesPage from "./GamesPage";

beforeEach(() => {
  hoisted.input = LIBRARY_GAMES_INPUT;
  hoisted.hubFailure = null;
  hoisted.enqueue.mockReset();
  hoisted.cancel.mockReset();
});
afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

function renderPage() {
  render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter initialEntries={["/library/games"]}>
        <GamesPage />
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe("the Library games page's text", () => {
  it("shows the fixture catalog's page title", () => {
    i18n.loadAndActivate({
      locale: "fr",
      messages: { [msg`Games`.id]: "Fixture jeux" },
    });
    renderPage();
    expect(screen.getAllByText("Fixture jeux").length).toBeGreaterThan(0);
  });

  it("stays in English when the catalog has no translation", () => {
    renderPage();
    expect(screen.getAllByText("Games").length).toBeGreaterThan(0);
    expect(screen.queryByText("Fixture jeux")).toBeNull();
  });
});
