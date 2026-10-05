// @vitest-environment happy-dom
/**
 * The Conquest "Generate a map" form while the game's skirmish AI list is
 * loading or has failed (issue #3613). Neither reads as "no skirmish AIs".
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  drawerContent: null as unknown,
  games: [] as unknown[],
  ais: { ais: [] as unknown[], loaded: false, failed: false },
}));

vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useDrawer: () => ({
    open: (o: { content: unknown }) => {
      h.drawerContent = o.content;
    },
    close: vi.fn(),
  }),
  // The frame's settings need its provider. The form reads a last game from them.
  useSetting: (_key: string, fallback: unknown) => [fallback, () => {}],
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("../../content/config", () => ({
  useUnitsyncGameHeaders: () => ({ headers: new Map() }),
  useScanEpoch: () => 0,
  useUnitsyncScan: () => ({
    data: {
      games: h.games,
      maps: [{ name: "Comet Catcher Remake", width: 16, height: 16 }],
      errors: [],
    },
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
  useGamePresetParam: () => "Cool Game v1",
}));
vi.mock("../../deeplink/useImportParam", () => ({
  useImportParam: () => ({ code: null, hubItemId: null }),
}));
vi.mock("../../hub/imports", () => ({ useRecordHubImport: () => vi.fn() }));
vi.mock("../../play/useGameCatalog", () => ({ useGameCatalog: () => [] }));
vi.mock("../../play/config", () => ({
  usePlayReadiness: () => ({
    target: { enginePath: "/engine", dataDir: "/data" },
    state: "ready",
    scanErrors: [],
    scanFailure: null,
    refresh: vi.fn(),
  }),
  usePreferredTarget: () => ({
    target: { enginePath: "/engine", dataDir: "/data" },
  }),
  useSkirmishAis: () => ({ loading: false, ...h.ais }),
}));
vi.mock("../conquests", () => ({
  refreshGalaxies: vi.fn(),
  useGalaxies: () => ({ galaxies: [], loading: false, error: null }),
  useConquestState: () => ({ file: { conquests: {} }, saveFor: vi.fn() }),
}));
vi.mock("@/factions/logos", () => ({ useFactionLogo: () => null }));
// The form waits for the game archives to be searched, which this test is not
// about, so the search has answered with nothing.
vi.mock("../handmade/useHandmadeMaps", () => ({
  refreshHandmadeMaps: vi.fn(),
  useHandmadeMaps: () => ({
    maps: [],
    unreadable: [],
    onlyOwnMaps: [],
    loading: false,
    savedLoading: false,
    error: null,
  }),
  useGameMapFacts: () => ({
    loading: false,
    facts: { maps: [], onlyOwnMaps: [] },
    error: undefined,
  }),
}));
// The unlocks live in the frame's settings store, which this page is rendered
// without.
vi.mock("../useUnlocks", () => ({
  useConquestUnlocks: () => ({ unlocks: {}, award: vi.fn() }),
  useAwardFinishedConquest: () => {},
}));

import ConquestListPage from "./ConquestListPage";

const game = () => ({
  name: "Cool Game v1",
  info: { shortname: "CG", version: "v1" },
  primaryArchive: { name: "Cool Game v1" },
});

function openForm(games: unknown[]) {
  h.games = games;
  render(
    <MemoryRouter>
      <ConquestListPage />
    </MemoryRouter>,
  );
  cleanup();
  render(<MemoryRouter>{h.drawerContent as ReactNode}</MemoryRouter>);
}

beforeEach(() => {
  h.drawerContent = null;
  h.ais = { ais: [], loaded: false, failed: false };
});
afterEach(cleanup);

const NO_AIS = /This game has no skirmish AIs/;

describe("Conquest generate form and the skirmish AI list", () => {
  it("says the list is loading, not that the game has no AIs", () => {
    openForm([game()]);
    expect(screen.getByText(/Loading this game's skirmish AIs/)).toBeTruthy();
    expect(screen.queryByText(NO_AIS)).toBeNull();
  });

  it("says the list could not be read when the query failed", () => {
    h.ais = { ais: [], loaded: true, failed: true };
    openForm([game()]);
    expect(screen.getByText(/could not be listed/)).toBeTruthy();
    expect(screen.queryByText(NO_AIS)).toBeNull();
  });

  it("says the game has no AIs once an empty list has loaded", () => {
    h.ais = { ais: [], loaded: true, failed: false };
    openForm([game()]);
    expect(screen.getByText(NO_AIS)).toBeTruthy();
  });

  it("shows the form once the AIs have loaded", () => {
    h.ais = {
      ais: [{ shortName: "NullAI", version: "1", name: "NullAI" }],
      loaded: true,
      failed: false,
    };
    openForm([game()]);
    expect(screen.getByRole("button", { name: "Create map" })).toBeTruthy();
  });
});
