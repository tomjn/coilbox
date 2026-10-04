// @vitest-environment happy-dom

/**
 * The singleplayer page when the content scan failed (issue #3423). unitsync's
 * `Init` failing leaves the scan hook with no data and the engine's reason, and
 * the page used to answer that with a Start button that was disabled for no
 * stated reason and pickers that claimed nothing was installed.
 *
 * The page is rendered for real. The scan hooks, the engine target and the
 * heavy children are stood in for, so the test reads what the page tells the
 * player and what it hands the two pickers.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const REASON = "no space left on device";

vi.mock("@picoframe/frame", async (importOriginal) => {
  const react = await import("react");
  return {
    ...(await importOriginal<object>()),
    usePersistentValue: <T,>(_key: string, initial: T) =>
      react.useState<T>(initial),
    useSetting: <T,>(_key: string, initial: T) => react.useState<T>(initial),
  };
});

vi.mock("@/content/config", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUnitsyncScan: () => ({
    data: null,
    unvouched: null,
    error: REASON,
    loading: false,
    cancelled: false,
    run: vi.fn(),
    cancel: vi.fn(),
  }),
  useUnitsyncThumbnails: () => ({ thumbs: new Map() }),
  useUnitsyncMapMeta: () => ({ meta: new Map() }),
  useUnitsyncGameHeaders: () => ({ headers: new Map() }),
  useUnitsyncGameInfo: () => ({ info: null, loading: false }),
  useUnitsyncMinimap: () => ({
    url: null,
    startPositions: [],
    loading: false,
    env: undefined,
  }),
  useReplays: () => ({ replays: [], refresh: vi.fn() }),
}));

vi.mock("../config", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePreferredTarget: () => ({
    target: {
      enginePath: "/engine",
      dataDir: "/data",
      executable: "/engine/spring",
    },
    loading: false,
    refresh: vi.fn(),
  }),
  useSkirmishAis: () => ({ ais: [], loaded: true }),
}));

vi.mock("@/multiplayer/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMultiplayer: () => ({ connections: new Map(), activeKey: null }),
  useProtocolServers: () => [],
}));

vi.mock("../PlayProvider", () => ({
  usePlay: () => ({ running: false, launch: vi.fn() }),
}));

// Stand-ins that print what the page hands them.
vi.mock("./components/GameSelectCard", () => ({
  GameSelectCard: ({ scanError }: { scanError?: string | null }) => (
    <div data-testid="game-card">{scanError ?? "no scan error"}</div>
  ),
}));
vi.mock("./components/MapCard", () => ({
  MapCard: ({ scanError }: { scanError?: string | null }) => (
    <div data-testid="map-card">{scanError ?? "no scan error"}</div>
  ),
}));
vi.mock("./components/ParticipantsTable", () => ({
  ParticipantsTable: () => null,
}));
vi.mock("../useAiBonusSuggestions", () => ({
  useAiBonusSuggestions: () => ({ rows: {}, all: null }),
}));
vi.mock("./components/GameOptionsPanel", () => ({
  GameOptionsPanel: () => null,
}));
vi.mock("./components/PresetsDrawer", () => ({ PresetsDrawer: () => null }));
vi.mock("./components/DebriefDrawer", () => ({ DebriefDrawer: () => null }));

import SkirmishPage from "./SkirmishPage";

afterEach(cleanup);

function renderPage() {
  return render(
    <MemoryRouter>
      <SkirmishPage />
    </MemoryRouter>,
  );
}

describe("SkirmishPage when the content scan failed", () => {
  it("shows the engine's reason", () => {
    renderPage();

    expect(
      screen.getByText(/The scan failed, so no games and maps are listed/),
    ).toBeTruthy();
    expect(
      screen.getByText(new RegExp(`unitsync said: ${REASON}`)),
    ).toBeTruthy();
  });

  it("keeps Start disabled and does not claim anything is installed or missing", () => {
    renderPage();

    const start = screen.getByRole("button", { name: /Start Game/ });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).not.toMatch(
      /not installed|No games are installed/,
    );
  });

  it("hands both pickers the reason so they do not say nothing is installed", () => {
    renderPage();

    expect(screen.getByTestId("game-card").textContent).toBe(REASON);
    expect(screen.getByTestId("map-card").textContent).toBe(REASON);
  });
});
