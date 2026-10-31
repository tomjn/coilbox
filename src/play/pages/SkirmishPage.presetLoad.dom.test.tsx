// @vitest-environment happy-dom

/**
 * Loading a saved preset whose game or map is not installed (issue #1302). The
 * check is the one an imported preset waits behind, so the setup must not change
 * until it passes, and cancelling must leave it alone.
 *
 * Stood in the same way as `SkirmishPage.dom.test.tsx`. The content gate's own
 * hook is stood in for with a real diff against the scan the test controls, so
 * "the download finished" is the test adding the game to that scan.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({
  scan: null as unknown,
  gameOptions: [] as { key: string; name: string }[],
  notices: [] as { title: string; body?: string; level: string }[],
}));

const scanOf = (games: string[], maps: string[]) => ({
  games: games.map((name) => ({
    name,
    primaryArchive: { name: `${name}.sdz` },
    dependencyArchives: [],
    info: {},
  })),
  maps: maps.map((name) => ({ name })),
});

const PRESET = vi.hoisted(() => ({
  id: "preset-1",
  name: "Ruleset",
  createdAt: "",
  lastUsedAt: "",
  participants: [],
  gameName: "Game 3.0",
  mapName: "Far Map",
  startPosType: 0,
  modOptionValues: { maxunits: "8000", bogus: "1" },
}));

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
    data: world.scan,
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
  useUnitsyncGameInfo: () => ({
    info: { options: world.gameOptions },
    status: "ready",
    loading: false,
  }),
  useUnitsyncMinimap: () => ({
    url: null,
    startPositions: [],
    loading: false,
    env: undefined,
  }),
  useReplays: () => ({ replays: [], refresh: vi.fn() }),
}));

vi.mock("@/content/useResolveContent", async () => {
  const real = await vi.importActual<typeof import("@/content/resolveContent")>(
    "@/content/resolveContent",
  );
  return {
    useResolveContent: (
      requirements: Parameters<typeof real.computeMissingRequirements>[0],
    ) => {
      const scan = world.scan as ReturnType<typeof scanOf>;
      const missing = real.computeMissingRequirements(requirements, {
        games: scan.games.map((g) => ({ name: g.name })),
        maps: scan.maps.map((m) => m.name),
        engineVersions: [],
      });
      return {
        loading: false,
        unreadable: false,
        unreadableReason: null,
        missing,
        resolved: missing.length === 0,
        download: vi.fn(),
        statusFor: () => null,
        itemFor: () => null,
        errorFor: () => null,
        canDownload: () => true,
        noWriteRoot: false,
      };
    },
  };
});
vi.mock("@/downloads/pages/components/ProgressBar", () => ({
  QueueProgress: () => null,
}));

vi.mock("@/notify/notify", () => ({
  notify: async (n: { title: string; body?: string; level: string }) => {
    world.notices.push(n);
  },
  recordQuietly: () => {},
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

vi.mock("../presets", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSkirmishPresets: () => ({
    presets: [],
    savePreset: vi.fn(),
    touchPreset: vi.fn(),
    removePreset: vi.fn(),
  }),
}));

vi.mock("../PlayProvider", () => ({
  usePlay: () => ({ running: false, launch: vi.fn() }),
}));

// Stand-ins that print what the page holds.
vi.mock("./components/GameSelectCard", () => ({
  GameSelectCard: ({ game }: { game?: { name: string } | null }) => (
    <div data-testid="game">{game?.name ?? "none"}</div>
  ),
}));
vi.mock("./components/MapCard", () => ({
  MapCard: ({ map }: { map?: { name: string } | null }) => (
    <div data-testid="map">{map?.name ?? "none"}</div>
  ),
}));
vi.mock("./components/GameOptionsPanel", () => ({
  GameOptionsPanel: ({
    optionValues,
  }: {
    optionValues: Record<string, string>;
  }) => <div data-testid="options">{JSON.stringify(optionValues)}</div>,
}));
vi.mock("./components/ParticipantsTable", () => ({
  ParticipantsTable: () => null,
}));
vi.mock("../useAiBonusSuggestions", () => ({
  useAiBonusSuggestions: () => ({ rows: {}, all: null }),
}));
vi.mock("./components/PresetsDrawer", () => ({
  PresetsDrawer: ({ onLoad }: { onLoad: (p: unknown) => void }) => (
    <button type="button" onClick={() => onLoad(PRESET)}>
      Load the preset
    </button>
  ),
}));
vi.mock("./components/DebriefDrawer", () => ({ DebriefDrawer: () => null }));

import SkirmishPage from "./SkirmishPage";

// A fresh element each time, so a rerender is not skipped as unchanged.
const tree = () => (
  <MemoryRouter>
    <SkirmishPage />
  </MemoryRouter>
);

beforeEach(() => {
  world.scan = scanOf(["Game 1.0", "Game 2.0"], ["Map A"]);
  world.gameOptions = [{ key: "maxunits", name: "Max units" }];
  world.notices = [];
});
afterEach(cleanup);

const shown = (id: string) => screen.getByTestId(id).textContent;
const load = () => fireEvent.click(screen.getByText("Load the preset"));
const gateOpen = () => screen.queryByText("Load this preset") !== null;

describe("loading a saved preset", () => {
  it("loads with no prompt when its game and map are installed", () => {
    world.scan = scanOf(["Game 1.0", "Game 3.0"], ["Map A", "Far Map"]);
    render(tree());

    load();

    expect(gateOpen()).toBe(false);
    expect(shown("game")).toBe("Game 3.0");
    expect(shown("map")).toBe("Far Map");
    expect(shown("options")).toBe(JSON.stringify(PRESET.modOptionValues));
  });

  it("offers the download of a missing game and map, and loads the whole preset once they arrive", () => {
    const { rerender } = render(tree());
    expect(shown("game")).toBe("Game 1.0");

    load();

    expect(gateOpen()).toBe(true);
    expect(screen.getByText("Game 3.0")).toBeTruthy();
    expect(screen.getByText("Far Map")).toBeTruthy();
    // Nothing moves while the gate waits.
    expect(shown("game")).toBe("Game 1.0");
    expect(shown("map")).toBe("Map A");

    world.scan = scanOf(["Game 1.0", "Game 3.0"], ["Map A", "Far Map"]);
    act(() => rerender(tree()));

    expect(gateOpen()).toBe(false);
    expect(shown("game")).toBe("Game 3.0");
    expect(shown("map")).toBe("Far Map");
    expect(shown("options")).toBe(JSON.stringify(PRESET.modOptionValues));
  });

  it("offers only the map when the game is here", () => {
    world.scan = scanOf(["Game 1.0", "Game 3.0"], ["Map A"]);
    render(tree());

    load();

    expect(gateOpen()).toBe(true);
    expect(screen.getByText("Far Map")).toBeTruthy();
    expect(screen.queryByText(/Load without the game/)).toBeNull();
  });

  it("leaves the setup as it was when the player cancels", () => {
    render(tree());

    load();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(gateOpen()).toBe(false);
    expect(shown("game")).toBe("Game 1.0");
    expect(shown("map")).toBe("Map A");
    expect(shown("options")).toBe("{}");
    expect(world.notices).toEqual([]);
  });

  it("offers an installed version of the game and loading without it", () => {
    render(tree());

    load();

    expect(
      screen.getByRole("button", { name: "Load onto Game 1.0" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Load onto Game 2.0" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Load without the game" }),
    ).toBeTruthy();
  });

  it("loads onto the chosen version, with its options, and names the ones it does not declare", () => {
    world.scan = scanOf(["Game 1.0", "Game 2.0"], ["Map A", "Far Map"]);
    render(tree());

    load();
    fireEvent.click(screen.getByRole("button", { name: "Load onto Game 2.0" }));

    expect(gateOpen()).toBe(false);
    expect(shown("game")).toBe("Game 2.0");
    expect(shown("map")).toBe("Far Map");
    expect(shown("options")).toBe(JSON.stringify(PRESET.modOptionValues));
    expect(world.notices).toEqual([
      {
        title: 'Loaded "Ruleset" onto Game 2.0',
        body: "Game 2.0 does not declare bogus.",
        level: "warning",
      },
    ]);
  });

  it("still checks the map after choosing another version", () => {
    render(tree());

    load();
    fireEvent.click(screen.getByRole("button", { name: "Load onto Game 2.0" }));

    expect(gateOpen()).toBe(true);
    expect(screen.queryByText("Game 3.0")).toBeNull();
    expect(screen.getByText("Far Map")).toBeTruthy();
    expect(shown("game")).toBe("Game 1.0");
  });

  it("loads the parts that need no game, and says so, when asked to go without it", () => {
    world.scan = scanOf(["Game 1.0"], ["Map A", "Far Map"]);
    render(tree());

    load();
    fireEvent.click(
      screen.getByRole("button", { name: "Load without the game" }),
    );

    expect(gateOpen()).toBe(false);
    expect(shown("game")).toBe("Game 1.0");
    expect(shown("map")).toBe("Far Map");
    expect(shown("options")).toBe("{}");
    expect(world.notices.map((n) => n.title)).toEqual([
      "You do not have Game 3.0",
    ]);
  });
});
