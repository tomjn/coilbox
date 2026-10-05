// @vitest-environment happy-dom
/**
 * The Conquest "Generate a map" form for a game that depends on an archive
 * that is not installed (issue #3489). Creating a map is not a launch, so the
 * form stays usable, but it says the game cannot launch yet.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  drawerContent: null as unknown,
  games: [] as unknown[],
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
  useSkirmishAis: () => ({
    ais: [{ shortName: "NullAI", version: "1", name: "NullAI" }],
    loading: false,
    loaded: true,
  }),
}));
vi.mock("../conquests", () => ({
  refreshGalaxies: vi.fn(),
  useGalaxies: () => ({ galaxies: [], loading: false, error: null }),
  useConquestState: () => ({ file: { conquests: {} }, saveFor: vi.fn() }),
}));
vi.mock("@/factions/logos", () => ({ useFactionLogo: () => null }));
// The unlocks live in the frame's settings store, which this page is rendered
// without.
vi.mock("../useUnlocks", () => ({
  useConquestUnlocks: () => ({ unlocks: {}, award: vi.fn() }),
  useAwardFinishedConquest: () => {},
}));

import ConquestListPage from "./ConquestListPage";

const game = (missingDependencies?: string[]) => ({
  name: "Cool Game v1",
  info: { shortname: "CG", version: "v1" },
  primaryArchive: { name: "Cool Game v1" },
  missingDependencies,
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
});
afterEach(cleanup);

describe("Conquest generate form and a missing dependency archive", () => {
  it("names the missing archive and still lets the player create the map", () => {
    openForm([game(["base-content"])]);
    expect(
      screen.getByText(/Archive not installed: base-content\. Cool Game v1/),
    ).toBeTruthy();
    const create = screen.getByRole("button", { name: "Create map" });
    expect((create as HTMLButtonElement).disabled).toBe(false);
  });

  it("says nothing when no dependency is missing", () => {
    openForm([game(undefined)]);
    expect(screen.getByRole("button", { name: "Create map" })).toBeTruthy();
    expect(screen.queryByText(/Archive not installed/)).toBeNull();
    expect(screen.queryByText(/missing something it depends on/)).toBeNull();
  });
});
