// @vitest-environment happy-dom

/**
 * Issue #4562. Starting a skirmish launches the game's compatibility mode
 * mutator in place of the game the player picked, but only when that game's
 * switch is on and the mutator is current. A stale mutator stops the launch.
 *
 * The page is rendered for real with the same stand-ins as
 * `SkirmishPage.roster.dom.test.tsx`. The engine launch and the plugin calls
 * are mocked, and the test reads the config the launch receives.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Participant } from "../config";

const GAME = {
  name: "XTA 9.65",
  primaryArchive: { name: "xta-9.65.sd7", path: "/data/games/xta-9.65.sd7" },
  dependencyArchives: [],
  info: {},
};
const MUTATOR = {
  name: "XTA 9.65 (compat 2)",
  primaryArchive: {
    name: "coilbox-compat-xta-9.65-2.sdd",
    path: "/data/games/coilbox-compat-xta-9.65-2.sdd",
  },
  dependencyArchives: [],
  info: {},
};
const MAP = {
  name: "Comet Catcher Redux",
  archives: [{ name: "ccr.sd7", path: "/data/maps/ccr.sd7" }],
  info: {},
};

const h = vi.hoisted(() => ({
  launch: vi.fn(async (_kind: string, _opts: unknown) => ({ exitCode: 0 })),
  compatStatus: vi.fn(),
  compat: {} as Record<string, { enabled: boolean; version: number }>,
}));

const person = (
  id: string,
  kind: Participant["kind"],
  ai?: Participant["ai"],
): Participant => ({
  id,
  kind,
  name: id,
  side: "",
  color: [0.9, 0.24, 0.2],
  allyTeam: kind === "you" ? 0 : 1,
  spectator: false,
  ai,
});

const SAVED = {
  participants: [
    person("p0", "you"),
    person("p1", "ai", { kind: "native", shortName: "NullAI" }),
  ],
  gameName: GAME.name,
  mapName: MAP.name,
  startPosType: 0,
  modOptionValues: {},
};

vi.mock("@picoframe/frame", async (importOriginal) => {
  const react = await import("react");
  return {
    ...(await importOriginal<object>()),
    usePersistentValue: <T,>(_key: string, initial: T) =>
      react.useState<T>(initial),
    useSetting: <T,>(key: string, initial: T) =>
      react.useState<T>(
        key === "play.skirmish"
          ? (SAVED as T)
          : key === "content.compat"
            ? (h.compat as T)
            : initial,
      ),
  };
});

vi.mock("@/compat/bindings", () => ({
  compatStatus: (args: unknown) => h.compatStatus(args),
}));

vi.mock("@/content/config", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUnitsyncScan: () => ({
    data: { games: [GAME, MUTATOR], maps: [MAP] },
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
    info: { checksum: "1234abcd", options: [] },
    loading: false,
  }),
  useUnitsyncMinimap: () => ({
    url: null,
    startPositions: [],
    loading: false,
    env: undefined,
  }),
  useReplays: () => ({ replays: [], refresh: vi.fn() }),
  primeGameInfo: async () => ({ checksum: "1234abcd", options: [] }),
  primeMapInfo: async () => ({ options: [] }),
  primeScan: async () => ({ games: [GAME, MUTATOR], maps: [MAP] }),
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
  useSkirmishAis: () => ({
    ais: [{ kind: "native", shortName: "NullAI" }],
    loaded: true,
  }),
}));

vi.mock("@/multiplayer/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMultiplayer: () => ({ connections: new Map(), activeKey: null }),
  useProtocolServers: () => [],
}));

vi.mock("../PlayProvider", () => ({
  usePlay: () => ({
    running: false,
    relayed: false,
    cancel: vi.fn(),
    launch: h.launch,
  }),
}));

vi.mock("./components/GameSelectCard", () => ({ GameSelectCard: () => null }));
vi.mock("./components/MapCard", () => ({ MapCard: () => null }));
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

beforeEach(() => {
  h.launch.mockClear();
  h.compatStatus.mockReset();
  h.compatStatus.mockResolvedValue({
    latest: 2,
    folder: MUTATOR.primaryArchive.name,
    stale: [],
  });
  h.compat = {};
});
afterEach(cleanup);

function start() {
  render(
    <MemoryRouter>
      <SkirmishPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Start Game/ }));
}

type LaunchConfig = {
  gameType: string;
  modOptions?: Record<string, string>;
};
const launched = (): LaunchConfig =>
  (h.launch.mock.calls[0][1] as { config: LaunchConfig }).config;

describe("SkirmishPage with compatibility mode", () => {
  it("launches the mutator and passes the base game's name when the switch is on", async () => {
    h.compat = { [GAME.primaryArchive.name]: { enabled: true, version: 2 } };
    start();

    await vi.waitFor(() => expect(h.launch).toHaveBeenCalledTimes(1));
    expect(launched().gameType).toBe("XTA 9.65 (compat 2)");
    expect(launched().modOptions).toEqual({ coilbox_compat_base: "XTA 9.65" });
  });

  it("blocks the launch and says why when the mutator is stale", async () => {
    h.compat = { [GAME.primaryArchive.name]: { enabled: true, version: 2 } };
    h.compatStatus.mockResolvedValue({
      latest: 3,
      folder: MUTATOR.primaryArchive.name,
      stale: [{ kind: "manifest", built: 2, now: 3 }],
    });
    start();

    expect(await screen.findByText(/choose Rebuild/)).toBeTruthy();
    expect(h.launch).not.toHaveBeenCalled();
  });

  it("launches the game itself, and reads no mutator, when the switch is off", async () => {
    h.compat = { [GAME.primaryArchive.name]: { enabled: false, version: 2 } };
    start();

    await vi.waitFor(() => expect(h.launch).toHaveBeenCalledTimes(1));
    expect(launched().gameType).toBe("XTA 9.65");
    expect(launched().modOptions?.coilbox_compat_base).toBeUndefined();
    expect(h.compatStatus).not.toHaveBeenCalled();
  });
});
