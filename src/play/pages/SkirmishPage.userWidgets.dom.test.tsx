// @vitest-environment happy-dom

/**
 * Issue #5190. A skirmish start script turns on `allowuserwidgets` when the
 * game defines it and a coilbox widget is installed in the content root, and
 * leaves a value the player chose alone.
 *
 * The page is rendered for real with the same stand-ins as
 * `SkirmishPage.compat.dom.test.tsx`. The engine launch and the widget status
 * command are mocked, and the test reads the config the launch receives.
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
const MAP = {
  name: "Comet Catcher Redux",
  archives: [{ name: "ccr.sd7", path: "/data/maps/ccr.sd7" }],
  info: {},
};
const OPTION = {
  key: "allowuserwidgets",
  name: "Allow user widgets",
  type: "bool",
  default: "0",
};

const h = vi.hoisted(() => ({
  launch: vi.fn(async (_kind: string, _opts: unknown) => ({ exitCode: 0 })),
  widgetStatus: vi.fn(),
  options: [] as unknown[],
  saved: {} as Record<string, string>,
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
          ? ({ ...SAVED, modOptionValues: h.saved } as T)
          : initial,
      ),
  };
});

vi.mock("@/content/bindings", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  contentWidgetStatus: (args: unknown) => h.widgetStatus(args),
}));

vi.mock("@/content/config", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUnitsyncScan: () => ({
    data: { games: [GAME], maps: [MAP] },
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
    info: { checksum: "1234abcd", options: h.options },
    loading: false,
  }),
  useUnitsyncMinimap: () => ({
    url: null,
    startPositions: [],
    loading: false,
    env: undefined,
  }),
  useReplays: () => ({ replays: [], refresh: vi.fn() }),
  primeGameInfo: async () => ({ checksum: "1234abcd", options: h.options }),
  primeMapInfo: async () => ({ options: [] }),
  primeScan: async () => ({ games: [GAME], maps: [MAP] }),
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

const status = (blueprints: boolean, skeleton: boolean) =>
  vi.fn(async ({ widget }: { widget: string }) => ({
    installed: widget === "blueprints" ? blueprints : skeleton,
    current: true,
    files: [],
    stale: [],
  }));

beforeEach(() => {
  h.launch.mockClear();
  h.widgetStatus = status(false, false);
  h.options = [OPTION];
  h.saved = {};
});
afterEach(cleanup);

function start() {
  render(
    <MemoryRouter>
      <SkirmishPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Start game/ }));
}

type LaunchConfig = { modOptions?: Record<string, string> };
const launched = (): LaunchConfig =>
  (h.launch.mock.calls[0][1] as { config: LaunchConfig }).config;

describe("SkirmishPage and user widgets", () => {
  it("turns allowuserwidgets on when a widget is installed and the game defines it", async () => {
    h.widgetStatus = status(false, true);
    start();

    await vi.waitFor(() => expect(h.launch).toHaveBeenCalledTimes(1));
    expect(launched().modOptions).toEqual({ allowuserwidgets: "1" });
    expect(h.widgetStatus).toHaveBeenCalledWith({
      rootPath: "/data",
      widget: "skeleton",
    });
  });

  it("turns it on for the blueprints widget alone", async () => {
    h.widgetStatus = status(true, false);
    start();

    await vi.waitFor(() => expect(h.launch).toHaveBeenCalledTimes(1));
    expect(launched().modOptions).toEqual({ allowuserwidgets: "1" });
  });

  it("leaves it out when no widget is installed", async () => {
    start();

    await vi.waitFor(() => expect(h.launch).toHaveBeenCalledTimes(1));
    expect(launched().modOptions).toBeUndefined();
  });

  it("leaves it out when the game does not define the option", async () => {
    h.widgetStatus = status(true, true);
    h.options = [];
    start();

    await vi.waitFor(() => expect(h.launch).toHaveBeenCalledTimes(1));
    expect(launched().modOptions).toBeUndefined();
  });

  it("keeps the value the player set", async () => {
    h.widgetStatus = status(true, true);
    h.saved = { allowuserwidgets: "0" };
    start();

    await vi.waitFor(() => expect(h.launch).toHaveBeenCalledTimes(1));
    expect(launched().modOptions).toEqual({ allowuserwidgets: "0" });
  });

  it("still launches when the widget status cannot be read", async () => {
    h.widgetStatus = vi.fn(async () => {
      throw new Error("no such folder");
    });
    start();

    await vi.waitFor(() => expect(h.launch).toHaveBeenCalledTimes(1));
    expect(launched().modOptions).toBeUndefined();
  });
});
