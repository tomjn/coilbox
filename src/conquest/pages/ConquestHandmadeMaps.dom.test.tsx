// @vitest-environment happy-dom
/**
 * Hand-made maps on the Conquest hub (issue #3509): a map is listed with its
 * title, description and picture, an imported one can be removed, a folder
 * that cannot be listed is shown with the reason, a conquest whose map is gone
 * is still shown, and "Import map" runs the import and says how it went.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HandmadeMapSummary,
  UnreadableHandmadeMap,
} from "../handmade/library";
import type { ConquestState } from "../model";

const h = vi.hoisted(() => ({
  drawerContent: null as unknown,
  drawerClose: vi.fn(),
  open: vi.fn(),
  importMap: vi.fn(),
  remove: vi.fn(),
  refreshMaps: vi.fn(),
  saveFor: vi.fn(),
  maps: [] as unknown[],
  unreadable: [] as unknown[],
  archiveError: undefined as string | undefined,
  conquests: {} as Record<string, unknown>,
}));

vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useDrawer: () => ({
    open: (o: { content: unknown }) => {
      h.drawerContent = o.content;
    },
    close: h.drawerClose,
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: h.open }));
vi.mock("../../content/config", () => ({
  useUnitsyncScan: () => ({
    data: { maps: [], games: [], errors: [] },
    error: null,
    loading: false,
    cancelled: false,
    unvouched: null,
    run: vi.fn(),
    cancel: vi.fn(),
  }),
}));
vi.mock("../../content/branding", () => ({
  resolveBranding: () => null,
  useBrandingCatalog: () => [],
}));
vi.mock("../../content/mapEligibility", () => ({
  useMapEligibility: () => ({ eligible: (m: unknown[]) => m }),
}));
vi.mock("../../content/useGamePresetParam", () => ({
  useGamePresetParam: () => null,
}));
vi.mock("../../deeplink/useImportParam", () => ({
  useImportParam: () => ({ code: null, hubItemId: null }),
}));
vi.mock("../../hub/imports", () => ({ useRecordHubImport: () => vi.fn() }));
vi.mock("../../play/useGameCatalog", () => ({ useGameCatalog: () => [] }));
vi.mock("../../play/config", () => {
  const target = {
    enginePath: "/engine",
    executable: "/engine/spring",
    dataDir: "/data",
    engineVersion: "1",
  };
  return {
    usePlayReadiness: () => ({
      target,
      state: "ready",
      scanErrors: [],
      scanFailure: null,
      refresh: vi.fn(),
    }),
    usePreferredTarget: () => ({ target }),
    useSkirmishAis: () => ({ ais: [], loading: false, loaded: true }),
  };
});
vi.mock("../conquests", () => ({
  refreshGalaxies: vi.fn(),
  useGalaxies: () => ({ galaxies: [], loading: false, error: null }),
  useConquestState: () => ({
    file: { conquests: h.conquests },
    error: null,
    saveFor: h.saveFor,
  }),
}));
vi.mock("../handmade/useHandmadeMaps", () => ({
  refreshHandmadeMaps: h.refreshMaps,
  useHandmadeMaps: () => ({
    maps: h.maps,
    unreadable: h.unreadable,
    onlyOwnMaps: [],
    archiveError: h.archiveError,
    loading: false,
    error: null,
  }),
}));
vi.mock("../handmade/library", () => ({
  importHandmadeMap: h.importMap,
  removeHandmadeMap: h.remove,
}));
vi.mock("@/factions/logos", () => ({ useFactionLogo: () => null }));
vi.mock("../useUnlocks", () => ({
  useConquestUnlocks: () => ({ unlocks: {}, award: vi.fn() }),
  useAwardFinishedConquest: () => {},
}));

import ConquestListPage from "./ConquestListPage";

const TWO_SHORES: HandmadeMapSummary = {
  id: "sample-two-shores",
  title: "Two Shores",
  description: "Two land masses and a strait.",
  game: { shortname: "TG" },
  source: "imported",
  pictureUrl: "coilbox://localhost/conquestmap/sample-two-shores/picture.png",
  warpath: false,
};

function conquest(change: Partial<ConquestState> = {}): ConquestState {
  return {
    seed: 7,
    turn: 3,
    playerFactionId: "west",
    owners: { a: "west", b: "east", c: "neutral", d: "west" },
    incursions: [],
    status: "active",
    history: [],
    updatedAt: "2026-10-01T00:00:00.000Z",
    handmade: { mapId: "sample-two-shores", title: "Two Shores", battles: {} },
    ...change,
  };
}

function renderIn(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

/** Press "Import map" with `zip` picked, then render the drawer it opened. */
async function importZip(zip: string | null) {
  h.open.mockResolvedValue(zip);
  renderIn(<ConquestListPage />);
  fireEvent.click(screen.getByRole("button", { name: /Import map/ }));
  await waitFor(() => expect(h.open).toHaveBeenCalled());
  await Promise.resolve();
  if (!h.drawerContent) return;
  cleanup();
  renderIn(h.drawerContent as ReactNode);
}

beforeEach(() => {
  h.drawerContent = null;
  h.maps = [TWO_SHORES];
  h.unreadable = [];
  h.archiveError = undefined;
  h.conquests = {};
  for (const mock of [
    h.drawerClose,
    h.open,
    h.importMap,
    h.remove,
    h.refreshMaps,
    h.saveFor,
  ]) {
    mock.mockReset();
  }
  h.refreshMaps.mockResolvedValue({ maps: [], unreadable: [] });
  h.remove.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("a hand-made map on the Conquest hub", () => {
  it("is listed with its title, description, game and picture", () => {
    const { container } = renderIn(<ConquestListPage />);
    expect(screen.getByText("Two Shores")).toBeTruthy();
    expect(
      screen.getByText(/TG · Hand-made map · Two land masses and a strait\./),
    ).toBeTruthy();
    expect(screen.getByText("Not started")).toBeTruthy();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      TWO_SHORES.pictureUrl,
    );
    expect(
      screen.getByRole("link", { name: /Two Shores/ }).getAttribute("href"),
    ).toBe("/conquest/sample-two-shores");
  });

  it("can be removed when it was imported", async () => {
    renderIn(<ConquestListPage />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Two Shores" }));
    await waitFor(() => expect(h.refreshMaps).toHaveBeenCalled());
    expect(h.remove).toHaveBeenCalledWith("sample-two-shores");
  });

  it("says why when the remove fails", async () => {
    h.remove.mockRejectedValue(new Error("the folder is in use"));
    renderIn(<ConquestListPage />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Two Shores" }));
    expect(
      await screen.findByText(
        '"Two Shores" was not removed. the folder is in use',
      ),
    ).toBeTruthy();
  });

  it("offers no remove for a bundled map", () => {
    h.maps = [{ ...TWO_SHORES, source: "bundled" }];
    renderIn(<ConquestListPage />);
    expect(screen.getByText("Bundled")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("shows a folder that cannot be listed, with the reason", () => {
    const broken: UnreadableHandmadeMap = {
      folder: "half-done",
      source: "imported",
      errors: [
        {
          code: "manifest-json",
          message: "map.json is not valid JSON: unexpected end of input.",
        },
      ],
    };
    h.unreadable = [broken];
    renderIn(<ConquestListPage />);
    expect(screen.getByText(/folder\s+"half-done"/)).toBeTruthy();
    expect(
      screen.getByText("map.json is not valid JSON: unexpected end of input."),
    ).toBeTruthy();
  });

  it("shows a conquest in progress and abandons it without removing the map", () => {
    h.conquests = { "sample-two-shores": conquest() };
    renderIn(<ConquestListPage />);
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText("Turn 3 · 50% held")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abandon Two Shores" }));
    expect(h.saveFor).toHaveBeenCalledWith("sample-two-shores", undefined);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("still shows a conquest whose map is no longer installed", () => {
    h.maps = [];
    h.conquests = { "sample-two-shores": conquest() };
    renderIn(<ConquestListPage />);
    expect(screen.getByText("Two Shores")).toBeTruthy();
    expect(
      screen.getByText(
        /The map this conquest is played on is no longer installed\./,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abandon Two Shores" }));
    expect(h.saveFor).toHaveBeenCalledWith("sample-two-shores", undefined);
  });
});

describe("a hand-made map a game carries", () => {
  const CARRIED: HandmadeMapSummary = {
    ...TWO_SHORES,
    source: "game",
    carriedBy: "Test Game 1.0",
  };

  it("is marked as the game's and cannot be removed", () => {
    h.maps = [CARRIED];
    renderIn(<ConquestListPage />);
    expect(screen.getByText("From the game")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("names the folder and the game when the folder cannot be listed", () => {
    h.unreadable = [
      {
        folder: "europe",
        source: "game",
        carriedBy: "Test Game 1.0",
        errors: [{ code: "manifest-json", message: "map.json is not JSON." }],
      },
    ];
    renderIn(<ConquestListPage />);
    expect(
      screen.getByText('"coilbox/maps/europe" in Test Game 1.0'),
    ).toBeTruthy();
  });

  it("says a game update may have removed the map of a saved conquest", () => {
    h.maps = [];
    h.conquests = {
      "sample-two-shores": conquest({
        handmade: {
          mapId: "sample-two-shores",
          title: "Two Shores",
          carriedBy: "Test Game 1.0",
          battles: {},
        },
      }),
    };
    renderIn(<ConquestListPage />);
    expect(
      screen.getByText(
        "The game Test Game 1.0 no longer carries the map this conquest is played on. A game update may have removed it. Your progress is saved (turn 3), and it carries on if a game carries the map again.",
      ),
    ).toBeTruthy();
  });

  it("calls no conquest lost while the games could not be searched", () => {
    h.maps = [];
    h.archiveError = "Init failed";
    h.conquests = { "sample-two-shores": conquest() };
    renderIn(<ConquestListPage />);
    expect(
      screen.getByText(/installed games could not be searched.*Init failed/),
    ).toBeTruthy();
    expect(screen.queryByText(/no longer installed/)).toBeNull();
  });
});

describe("Import map", () => {
  it("does nothing when no zip is picked", async () => {
    await importZip(null);
    expect(h.drawerContent).toBeNull();
    expect(h.importMap).not.toHaveBeenCalled();
  });

  it("imports the picked zip and offers to open the map", async () => {
    h.importMap.mockResolvedValue({
      status: "imported",
      id: "sample-two-shores",
      doc: { title: "Two Shores" },
      skipped: 2,
    });
    await importZip("/tmp/two-shores.zip");
    expect(
      await screen.findByText(/"Two Shores" is imported and listed/),
    ).toBeTruthy();
    expect(h.importMap).toHaveBeenCalledTimes(1);
    expect(h.importMap).toHaveBeenCalledWith("/tmp/two-shores.zip", {
      replace: false,
    });
    expect(h.refreshMaps).toHaveBeenCalled();
    expect(screen.getByText(/2 files in the zip\s+were left out/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open the map" })).toBeTruthy();
  });

  it("asks before replacing a map that is installed", async () => {
    h.importMap.mockResolvedValueOnce({
      status: "exists",
      id: "sample-two-shores",
      title: "Two Shores",
    });
    h.importMap.mockResolvedValueOnce({
      status: "imported",
      id: "sample-two-shores",
      doc: { title: "Two Shores" },
      skipped: 0,
    });
    await importZip("/tmp/two-shores.zip");
    expect(
      await screen.findByText(/A map called "Two Shores" is already installed/),
    ).toBeTruthy();
    expect(h.refreshMaps).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Replace the map" }));
    expect(
      await screen.findByText(/"Two Shores" is imported and listed/),
    ).toBeTruthy();
    expect(h.importMap).toHaveBeenLastCalledWith("/tmp/two-shores.zip", {
      replace: true,
    });
  });

  it("keeps the installed map when the player declines", async () => {
    h.importMap.mockResolvedValue({
      status: "exists",
      id: "sample-two-shores",
      title: "Two Shores",
    });
    await importZip("/tmp/two-shores.zip");
    fireEvent.click(
      await screen.findByRole("button", { name: "Keep the installed map" }),
    );
    expect(h.drawerClose).toHaveBeenCalled();
    expect(h.importMap).toHaveBeenCalledTimes(1);
  });

  it("lists the reader's reasons for a map it refuses", async () => {
    h.importMap.mockResolvedValue({
      status: "invalid",
      errors: [
        {
          code: "province-not-painted",
          id: "midvale",
          name: "Midvale",
          color: "#7ab85a",
          message:
            'The province "Midvale" (#7ab85a) is listed in map.json, but its colour is not painted anywhere on the province image.',
        },
        {
          code: "capital-count",
          factionId: "east",
          factionName: "Eastern Crown",
          capitals: [],
          message: 'The faction "Eastern Crown" has no capital.',
        },
      ],
    });
    await importZip("/tmp/two-shores.zip");
    expect(await screen.findByText(/The map was not imported\./)).toBeTruthy();
    expect(
      screen.getByText(/The province "Midvale" \(#7ab85a\) is listed/),
    ).toBeTruthy();
    expect(
      screen.getByText('The faction "Eastern Crown" has no capital.'),
    ).toBeTruthy();
  });

  it("shows the message for a zip that is refused", async () => {
    h.importMap.mockResolvedValue({
      status: "refused",
      message: 'The zip holds "../x", which points outside the map folder.',
    });
    await importZip("/tmp/bad.zip");
    expect(
      await screen.findByText(
        'The map was not imported. The zip holds "../x", which points outside the map folder.',
      ),
    ).toBeTruthy();
  });
});
