// @vitest-environment happy-dom
/**
 * Issue #4579: Library > Games is one grid of the library record, filtered by
 * chips. With no hub to read it still lists what is installed, and says why
 * the rest is missing in one line.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
}));

import GamesPage from "./GamesPage";

beforeEach(() => {
  hoisted.input = LIBRARY_GAMES_INPUT;
  hoisted.hubFailure = null;
  hoisted.enqueue.mockReset();
  hoisted.cancel.mockReset();
});
afterEach(cleanup);

function renderPage(path = "/library/games") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GamesPage />
    </MemoryRouter>,
  );
}

const cardTitles = () =>
  screen
    .getAllByRole("listitem")
    .map((li) => li.querySelector("p[title]")?.getAttribute("title"));

describe("Games page", () => {
  it("lists every hub game and every installed game, featured first", () => {
    renderPage("/library/games?filter=all");
    expect(cardTitles()).toEqual([
      "SplinterFaction",
      "Zero-K",
      "Balanced Annihilation",
      "Evolution RTS",
      "Metal Factions",
      "My Test Game",
      "Tech Annihilation",
    ]);
  });

  it("opens on the player's own games", () => {
    renderPage();
    expect(
      screen
        .getByRole("radio", { name: /My Games/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(cardTitles()).toHaveLength(3);
  });

  it("opens on every game when the player has none", () => {
    hoisted.input = {
      ...LIBRARY_GAMES_INPUT,
      scan: { games: [], maps: [] },
      files: { games: [], maps: [] },
    };
    renderPage();
    expect(
      screen.getByRole("radio", { name: /All/ }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("gives each chip its count and filters by it", () => {
    renderPage();
    const chips = screen.getByRole("radiogroup", { name: "Show" });
    expect(
      within(chips)
        .getAllByRole("radio")
        .map((c) => c.textContent),
    ).toEqual(["All7", "My Games3", "New Games4", "Updates1", "Featured2"]);
    fireEvent.click(within(chips).getByRole("radio", { name: /Updates/ }));
    expect(cardTitles()).toEqual(["SplinterFaction"]);
  });

  it("opens on the chip the link names", () => {
    renderPage("/library/games?filter=updates");
    expect(
      screen
        .getByRole("radio", { name: /Updates/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(cardTitles()).toEqual(["SplinterFaction"]);
  });

  it("hides the Updates chip when nothing has an update", () => {
    hoisted.input = { ...LIBRARY_GAMES_INPUT, catalogues: [] };
    renderPage();
    expect(screen.queryByRole("radio", { name: /Updates/ })).toBeNull();
  });

  it("says when a chip has nothing in it", () => {
    hoisted.input = {
      ...LIBRARY_GAMES_INPUT,
      catalogues: [],
    };
    renderPage("/library/games?filter=updates");
    expect(
      screen.getByText("Every installed game is up to date."),
    ).toBeTruthy();
  });

  it("queues the hub's first source when Install is pressed", async () => {
    renderPage("/library/games?filter=all");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install" }));
    });
    expect(hoisted.enqueue).toHaveBeenCalledWith({
      kind: "rapid",
      label: "Metal Factions",
      args: { tag: "mf:stable" },
    });
  });

  it("cancels the running download", () => {
    renderPage("/library/games?filter=all");
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    expect(hoisted.cancel).toHaveBeenCalledWith("q1");
  });
});

describe("Games page with no hub", () => {
  it("still lists the installed games, with the hub's reason in one line", () => {
    hoisted.input = { ...LIBRARY_GAMES_INPUT, hubGames: [], queue: [] };
    hoisted.hubFailure =
      "Could not reach the hub at hub.example. Check your connection.";
    renderPage();
    expect(screen.getByRole("status").textContent).toBe(hoisted.hubFailure);
    // The hub was not read, so nothing can be said to be missing from it.
    expect(screen.queryByText(/not on the hub/)).toBeNull();
    expect(cardTitles()).toEqual([
      "Balanced Annihilation",
      "My Test Game",
      "SplinterFaction",
    ]);
  });

  it("shows no notice when the hub was read", () => {
    renderPage();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("v1.0 · not on the hub")).toBeTruthy();
  });
});
