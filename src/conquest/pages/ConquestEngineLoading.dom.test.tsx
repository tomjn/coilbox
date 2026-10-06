// @vitest-environment happy-dom
/**
 * While the installed engines are still being read, nobody knows whether there
 * is one. The Conquest hub and its Generate a map drawer must not tell the
 * player to install an engine then (issue #3684). They say it only once the
 * lookup has finished and found none.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  drawerContent: null as unknown,
  runScan: vi.fn(),
  preset: null as string | null,
  importCode: null as string | null,
  stateError: null as string | null,
  state: "finding-engine" as string,
  targetLoading: true,
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
    data: null,
    error: null,
    loading: false,
    cancelled: false,
    unvouched: null,
    run: h.runScan,
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
  useGamePresetParam: () => h.preset,
}));
vi.mock("../../deeplink/useImportParam", () => ({
  useImportParam: () => ({ code: h.importCode, hubItemId: null }),
}));
vi.mock("../../hub/imports", () => ({ useRecordHubImport: () => vi.fn() }));
vi.mock("../../play/useGameCatalog", () => ({ useGameCatalog: () => [] }));
vi.mock("../../play/config", () => ({
  usePlayReadiness: () => ({
    target: null,
    state: h.state,
    scanErrors: [],
    scanFailure: null,
    refresh: vi.fn(),
  }),
  usePreferredTarget: () => ({ target: null, loading: h.targetLoading }),
  useSkirmishAis: () => ({ ais: [], loading: false, loaded: true }),
}));
vi.mock("../handmade/useHandmadeMaps", () => ({
  refreshHandmadeMaps: vi.fn(),
  useHandmadeMaps: () => ({
    maps: [],
    unreadable: [],
    onlyOwnMaps: [],
    loading: false,
    savedLoading: false,
    error: null,
    archiveError: null,
  }),
  useGameMapFacts: () => ({ loading: false, facts: null, error: undefined }),
}));
vi.mock("../conquests", () => ({
  refreshGalaxies: vi.fn(),
  useGalaxies: () => ({ galaxies: [], loading: false, error: null }),
  useConquestState: () => ({
    file: { conquests: {} },
    error: h.stateError,
    saveFor: vi.fn(),
  }),
}));
vi.mock("@/factions/logos", () => ({ useFactionLogo: () => null }));
// The unlocks live in the frame's settings store, which this page is rendered
// without. Nothing is unlocked, so the generate form offers threat level 0.
vi.mock("../useUnlocks", () => ({
  useConquestUnlocks: () => ({ unlocks: {}, award: vi.fn() }),
  useAwardFinishedConquest: () => {},
}));

import ConquestListPage from "./ConquestListPage";

function renderIn(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

/** Open the Generate a map drawer from the page, then mount what it holds. */
function drawer() {
  h.preset = "Balanced Annihilation";
  renderIn(<ConquestListPage />);
  cleanup();
  renderIn(h.drawerContent as ReactNode);
}

beforeEach(() => {
  h.drawerContent = null;
  h.preset = null;
  h.state = "finding-engine";
  h.targetLoading = true;
});
afterEach(cleanup);

describe("Conquest while the engine is still being found", () => {
  it("does not say to install an engine on the hub", () => {
    renderIn(<ConquestListPage />);
    expect(screen.queryByText(/Install an engine/)).toBeNull();
    expect(screen.queryByText(/needs an engine and a game/)).toBeNull();
  });

  it("does not say to install an engine in the Generate a map drawer", () => {
    drawer();
    expect(screen.queryByText(/Install an engine/)).toBeNull();
    expect(screen.getByText("Looking for an engine…")).toBeTruthy();
  });
});

describe("Conquest once the engine lookup found none", () => {
  beforeEach(() => {
    h.state = "no-engine";
    h.targetLoading = false;
  });

  it("tells the player to install an engine on the hub", () => {
    renderIn(<ConquestListPage />);
    expect(screen.getAllByText(/Install an engine/).length).toBeGreaterThan(0);
  });

  it("tells the player to install an engine in the drawer", () => {
    drawer();
    expect(screen.getByText(/Install an engine first/)).toBeTruthy();
  });
});
