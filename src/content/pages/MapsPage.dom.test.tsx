// @vitest-environment happy-dom
/**
 * Issue #4581: Library > Maps is one grid merging the scan with every mirror
 * index, with state chips and play type chips read off the hub's facts.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapFacts } from "../../hub/maps/lookup";
import { LIBRARY_MAPS_INPUT, mapFacts } from "../fixtures/libraryMaps";
import { buildLibrary, type LibraryInput } from "../library";

const SELECTED = {
  enginePath: "/engines/105",
  rootPath: "/data",
  engineId: "105",
  engineVersion: "105",
};

const hoisted = vi.hoisted(() => ({
  input: null as LibraryInput | null,
  facts: new Map<string, MapFacts>(),
  hubOn: true,
  enqueue: vi.fn(),
  cancel: vi.fn(),
  openDrawer: vi.fn(),
}));

vi.mock("../config", () => ({
  useScanTargetSelection: () => ({
    targets: [SELECTED],
    selected: SELECTED,
    selectedKey: "k",
    setSelectedKey: () => {},
  }),
  useUnitsyncThumbnails: () => ({ thumbs: new Map(), loading: false }),
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
  useLibrary: () => ({
    ...buildLibrary(hoisted.input as LibraryInput),
    cataloguesRead: true,
    catalogueFailures: [
      { request: { source: "evolutionrts" }, reason: "HTTP 503" },
    ],
  }),
}));
vi.mock("../branding", () => ({
  filterUninstalledMaps: () => [],
  useSuggestedMaps: () => [],
  useCachedImage: () => undefined,
}));
vi.mock("../usePlayMap", () => ({ usePlayMap: () => () => {} }));
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
// Importing a setup pack from a deep link is the page's, not these tests'.
vi.mock("../../hub/imports", () => ({ useRecordHubImport: () => vi.fn() }));
vi.mock("@picoframe/frame", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@picoframe/frame")>()),
  useDrawer: () => ({ open: hoisted.openDrawer, close: vi.fn() }),
}));
vi.mock("../../downloads/pages/components/MapPacksBanner", () => ({
  MapPacksBanner: () => null,
}));
vi.mock("../../hub/maps/useMapFacts", () => ({
  useMapFactsBatch: (names: readonly string[]) => ({
    facts: new Map([...hoisted.facts].filter(([name]) => names.includes(name))),
    answered: true,
  }),
}));
vi.mock("../../profile/profile", () => ({
  isHubEnabled: () => hoisted.hubOn,
}));
vi.mock("./components/BrowserToolbar", () => ({
  BrowserToolbar: () => null,
  NoEngines: () => null,
  RescanButton: () => null,
}));

import MapsPage from "./MapsPage";

beforeEach(() => {
  hoisted.input = LIBRARY_MAPS_INPUT;
  hoisted.hubOn = true;
  hoisted.facts = new Map([
    ["Comet Catcher Redux", mapFacts(8)],
    ["Supreme Isthmus v2", mapFacts(2, ["water map"])],
    ["Isis", mapFacts(4)],
  ]);
  hoisted.enqueue.mockReset();
  hoisted.cancel.mockReset();
  hoisted.openDrawer.mockReset();
});
afterEach(cleanup);

function renderPage(url = "/library/maps") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <MapsPage />
    </MemoryRouter>,
  );
}

const cards = () => screen.getAllByRole("listitem");
const cardTitles = () =>
  cards().map((li) => li.querySelector("p[title]")?.getAttribute("title"));
const card = (title: string) => {
  const found = cards().find(
    (li) => li.querySelector("p[title]")?.getAttribute("title") === title,
  );
  if (!found) throw new Error(`no card ${title}`);
  return found;
};

function pressChip(name: RegExp) {
  const chips = screen.getByRole("radiogroup", { name: "Show" });
  fireEvent.click(within(chips).getByRole("radio", { name }));
}

describe("Maps page", () => {
  it("opens on the player's own maps", () => {
    renderPage();
    expect(
      screen
        .getByRole("radio", { name: /My Maps/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(cards()).toHaveLength(2);
  });

  it("splits the maps between My Maps and New Maps", () => {
    renderPage();
    expect(cardTitles()).toEqual(["Comet Catcher Redux", "my_test_map v3"]);
    pressChip(/New Maps/);
    expect(cardTitles()).toEqual(["Isis", "Supreme Isthmus v2"]);
  });

  it("draws an installed map on two mirrors once, installed, with both sources", () => {
    renderPage();
    const comet = card("Comet Catcher Redux");
    expect(within(comet).getByText("Installed")).toBeTruthy();
    expect(
      within(comet).getByText("12 × 12 · 8 starts · springfiles · hakora"),
    ).toBeTruthy();
    expect(within(comet).getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("gives each card the state the record holds", () => {
    renderPage();
    expect(within(card("my_test_map v3")).getByText("Local")).toBeTruthy();
    expect(
      within(card("my_test_map v3")).getByText("12 × 12 · not on any mirror"),
    ).toBeTruthy();
    pressChip(/New Maps/);
    expect(within(card("Isis")).getByText("Queued")).toBeTruthy();
    expect(within(card("Isis")).getByRole("button", { name: "Cancel" }));
    const isthmus = card("Supreme Isthmus v2");
    expect(within(isthmus).queryByText("Installed")).toBeNull();
    fireEvent.click(within(isthmus).getByRole("button", { name: "Install" }));
    expect(hoisted.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "mapAnySource",
        args: { mapName: "Supreme Isthmus v2", writePath: "/data" },
      }),
    );
  });

  it("counts the state chips and leaves the play type chips uncounted", () => {
    renderPage();
    const chips = within(screen.getByRole("radiogroup", { name: "Show" }))
      .getAllByRole("radio")
      .map((c) => c.textContent);
    expect(chips).toEqual(["My Maps2", "New Maps2", "1v1", "Team", "Water"]);
  });

  it("filters by start count and tag through the play type chips", () => {
    renderPage();
    pressChip(/^My Maps/);
    expect(cardTitles()).toEqual(["Comet Catcher Redux", "my_test_map v3"]);
    pressChip(/^1v1/);
    expect(cardTitles()).toEqual(["Supreme Isthmus v2"]);
    pressChip(/^Team/);
    expect(cardTitles()).toEqual(["Comet Catcher Redux", "Isis"]);
    pressChip(/^Water/);
    expect(cardTitles()).toEqual(["Supreme Isthmus v2"]);
  });

  it("says when no map matches a play type", () => {
    hoisted.facts = new Map();
    renderPage();
    pressChip(/^Water/);
    expect(screen.queryAllByRole("listitem")).toEqual([]);
    expect(screen.getByText("No water maps.")).toBeTruthy();
  });

  it("hides the play type chips when the hub is switched off", () => {
    hoisted.hubOn = false;
    renderPage();
    const chips = within(screen.getByRole("radiogroup", { name: "Show" }))
      .getAllByRole("radio")
      .map((c) => c.textContent);
    expect(chips).toEqual(["My Maps2", "New Maps2"]);
  });

  it("names a mirror index that could not be read", () => {
    renderPage();
    expect(screen.getByText("evolutionrts: HTTP 503")).toBeTruthy();
  });
});

describe("a setup pack deep link", () => {
  // `/downloads/maps?import=` redirects here with its query (issue #4584).
  it("opens the import drawer for the code in the query string", async () => {
    renderPage("/library/maps?import=ABC123");
    await waitFor(() => expect(hoisted.openDrawer).toHaveBeenCalledTimes(1));
    expect(hoisted.openDrawer.mock.calls[0][0]).toMatchObject({
      title: "Import a setup pack",
    });
  });

  it("opens nothing without a code", () => {
    renderPage();
    expect(hoisted.openDrawer).not.toHaveBeenCalled();
  });
});
