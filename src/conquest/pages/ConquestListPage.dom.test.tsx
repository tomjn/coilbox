// @vitest-environment happy-dom
/**
 * The Conquest hub when the scan failed (unitsync's Init failed, issue #3423).
 * The scan hook answers `data: null` with the reason in `error`. The hub, its
 * Generate drawer and its Import drawer must show the reason, claim no game is
 * missing, and not re-run the scan because data stays null.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REASON = "no space left on device";

const h = vi.hoisted(() => ({
  drawerContent: null as unknown,
  runScan: vi.fn(),
  preset: null as string | null,
  importCode: null as string | null,
  stateError: null as string | null,
}));

vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useDrawer: () => ({
    open: (o: { content: unknown }) => {
      h.drawerContent = o.content;
    },
    close: vi.fn(),
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("../../content/config", () => ({
  useScanEpoch: () => 0,
  useUnitsyncScan: () => ({
    data: null,
    error: REASON,
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
    target: {
      enginePath: "/engine",
      executable: "/engine/spring",
      dataDir: "/data",
      engineVersion: "1",
    },
    state: "unreadable",
    scanErrors: [],
    scanFailure: REASON,
    refresh: vi.fn(),
  }),
  usePreferredTarget: () => ({
    target: {
      enginePath: "/engine",
      executable: "/engine/spring",
      dataDir: "/data",
      engineVersion: "1",
    },
  }),
  useSkirmishAis: () => ({ ais: [], loading: false, loaded: true }),
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

beforeEach(() => {
  h.drawerContent = null;
  h.preset = null;
  h.importCode = null;
  h.stateError = null;
  h.runScan.mockClear();
});
afterEach(cleanup);

describe("ConquestListPage with a failed scan", () => {
  it("shows the reason on the hub", () => {
    renderIn(<ConquestListPage />);
    expect(screen.getByText(new RegExp(REASON))).toBeTruthy();
  });

  it("shows the reason in the Generate drawer, with the form blocked", () => {
    h.preset = "Balanced Annihilation";
    renderIn(<ConquestListPage />);
    cleanup();
    renderIn(h.drawerContent as ReactNode);
    expect(screen.getByText(new RegExp(REASON))).toBeTruthy();
    expect(screen.queryByText(/Install a game first/)).toBeNull();
    expect(h.runScan).not.toHaveBeenCalled();
  });

  it("does not re-run the scan from the Import drawer", () => {
    h.importCode = "COILBOX-CODE";
    renderIn(<ConquestListPage />);
    cleanup();
    renderIn(h.drawerContent as ReactNode);
    expect(h.runScan).not.toHaveBeenCalled();
  });
});

describe("ConquestListPage with a run state file that could not be read", () => {
  it("says so, that nothing was changed, and gives the reason", () => {
    h.stateError = "state.json is not valid JSON";
    renderIn(<ConquestListPage />);
    expect(
      screen.getByText(
        "Your conquest progress could not be read. Nothing has been changed. state.json is not valid JSON",
      ),
    ).toBeTruthy();
  });

  it("shows no such message when the file read", () => {
    renderIn(<ConquestListPage />);
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });
});
