// @vitest-environment happy-dom

/**
 * Singleplayer can launch an installed engine other than the preferred one.
 * The pick is a setting of its own, and a pick whose engine has gone falls back
 * to the preferred engine.
 *
 * The page is rendered for real with the same stand-ins as
 * `SkirmishPage.compat.dom.test.tsx`. The test reads which binary the launch
 * receives.
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

const NEW = {
  enginePath: "/engine-new",
  dataDir: "/data",
  executable: "/engine-new/spring",
  engineVersion: "2025.06.12",
};
const OLD = {
  enginePath: "/engine-old",
  dataDir: "/data",
  executable: "/engine-old/spring",
  engineVersion: "105.1.1-2511",
};

const h = vi.hoisted(() => ({
  launch: vi.fn(async (_kind: string, _opts: unknown) => ({ exitCode: 0 })),
  pick: "",
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
          : key === "play.skirmishEnginePath"
            ? (h.pick as T)
            : initial,
      ),
  };
});

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
  primeScan: async () => ({ games: [GAME], maps: [MAP] }),
}));

vi.mock("../config", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePreferredTarget: () => ({
    targets: [NEW, OLD],
    target: NEW,
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
  h.pick = "";
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

const launchedWith = (): string =>
  (h.launch.mock.calls[0][1] as { executable: string }).executable;

describe("SkirmishPage engine override", () => {
  it("launches the preferred engine when nothing is picked", async () => {
    start();
    await vi.waitFor(() => expect(h.launch).toHaveBeenCalledTimes(1));
    expect(launchedWith()).toBe("/engine-new/spring");
  });

  it("launches the picked engine", async () => {
    h.pick = "/engine-old";
    start();
    await vi.waitFor(() => expect(h.launch).toHaveBeenCalledTimes(1));
    expect(launchedWith()).toBe("/engine-old/spring");
  });

  it("falls back to the preferred engine when the picked one is gone", async () => {
    h.pick = "/engine-removed";
    start();
    await vi.waitFor(() => expect(h.launch).toHaveBeenCalledTimes(1));
    expect(launchedWith()).toBe("/engine-new/spring");
  });
});
