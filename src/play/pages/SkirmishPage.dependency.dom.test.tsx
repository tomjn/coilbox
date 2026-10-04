// @vitest-environment happy-dom

/**
 * The singleplayer page on a game whose dependency archive is not installed
 * (issue #3489). The engine would stop with `Dependent archive "..." not
 * found`, so the page names the archive first and keeps Start and Host off.
 *
 * Stood in the same way as `SkirmishPage.dom.test.tsx`.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const scanData = vi.hoisted(() => ({
  current: null as unknown,
}));

const scanOf = (missingDependencies?: string[]) => ({
  games: [
    {
      name: "Zero-K Benchmark v3",
      primaryArchive: { name: "zkb.sdz" },
      dependencyArchives: [],
      info: {},
      ...(missingDependencies ? { missingDependencies } : {}),
    },
  ],
  maps: [{ name: "Comet Catcher Redux" }],
});

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
    data: scanData.current,
    unvouched: null,
    error: null,
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

const button = (name: RegExp) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

describe("SkirmishPage on a game with a missing dependency archive", () => {
  it("names the archive and the game, links to game downloads, and keeps Start and Host off", () => {
    scanData.current = scanOf(["zero-k v1.7.6.4"]);
    renderPage();

    expect(
      screen.getByText(
        "Archive not installed: zero-k v1.7.6.4. Zero-K Benchmark v3 depends on it.",
        { exact: false },
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /Open game downloads/ })
        .getAttribute("href"),
    ).toBe("/downloads/games");
    expect(button(/Start Game/).disabled).toBe(true);
    expect(button(/Host/).disabled).toBe(true);
  });

  it("says nothing and leaves Host on for a game that lacks nothing", () => {
    scanData.current = scanOf([]);
    renderPage();

    expect(document.body.textContent).not.toMatch(/Archive not installed/);
    expect(button(/Host/).disabled).toBe(false);
  });

  it("reads a scan from an older worker, with no field, as none known", () => {
    scanData.current = scanOf();
    renderPage();

    expect(document.body.textContent).not.toMatch(/Archive not installed/);
    expect(button(/Host/).disabled).toBe(false);
  });
});
