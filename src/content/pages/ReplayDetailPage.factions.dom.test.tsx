// @vitest-environment happy-dom
/**
 * Issue #5489: the roster names the faction a player picked in the match, from
 * the unit list and the sides of the installed game, and keeps the start
 * script's side for everyone else.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { HashRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const FILE = "a.sdfz";

const h = vi.hoisted(() => ({
  installed: true,
  info: {
    engineVersion: "",
    startTimeMs: 0,
    durationSec: 0,
    wallclockSec: 0,
    mapName: "Some Map",
    gameType: "Some Game",
    winningAllyTeams: [],
    winnersKnown: false,
    numAllyTeams: 1,
    allyTeams: [],
    players: [
      {
        name: "Picker",
        team: 0,
        allyTeam: 0,
        side: "Armada",
        pick: { frame: -1, unitDefId: 2 },
        spectator: false,
      },
      {
        name: "Silent",
        team: 1,
        allyTeam: 0,
        side: "Cortex",
        spectator: false,
      },
    ],
    ais: [],
    modOptions: {},
    mapOptions: {},
  },
}));
const SIDES = vi.hoisted(() => ({
  sides: [
    { name: "Armada", startUnit: "armcom" },
    { name: "Legion", startUnit: "legcom" },
  ],
}));
const DATASET = vi.hoisted(() => ({
  units: [{ name: "armcom" }, { name: "legcom" }],
}));

vi.mock("../config", () => ({
  invalidateMapPreview: () => {},
  useDemoInfo: () => ({ info: h.info, loading: false, error: null }),
  useReplays: () => ({
    replays: [
      { filename: FILE, path: `/replays/${FILE}`, sizeBytes: 1, modifiedMs: 0 },
    ],
    loading: false,
    refresh: async () => {},
  }),
  useScanTargetSelection: () => ({
    selected: {
      enginePath: "/engines/105",
      rootPath: "/data",
      engineId: "105",
      engineVersion: "105",
    },
  }),
  useUnitsyncScan: () => ({
    data: {
      games: h.installed
        ? [
            {
              name: "Some Game",
              info: {},
              primaryArchive: { name: "some.sdz" },
            },
          ]
        : [],
      maps: [{ name: "Some Map" }],
      errors: [],
    },
    loading: false,
    error: null,
  }),
  useUnitsyncGameInfo: (_e: string, _d: string, archive?: string) => ({
    info: archive ? SIDES : null,
    status: archive ? "ready" : "idle",
    loading: false,
  }),
  useUnitsyncUnitDataset: (_e: string, _d: string, archive?: string) => ({
    dataset: archive ? DATASET : null,
    status: archive ? "ready" : "idle",
    loading: false,
  }),
  useUnitsyncHeightmap: () => ({}),
  useUnitsyncMapSkybox: () => ({}),
  useUnitsyncMinimap: () => ({ startPositions: [] }),
}));
vi.mock("../useReplaysRoot", () => ({ useReplaysRoot: () => "/replays" }));
vi.mock("../../play/config", () => ({
  useReplayTarget: () => ({
    resolved: { target: { engineVersion: "105" }, matched: true },
  }),
}));
vi.mock("../useReplayEngine", () => ({
  useReplayEngine: () => ({
    watch: { kind: "recorded" },
    notice: { kind: "none" },
  }),
}));
vi.mock("../replaySets", () => ({
  useReplaySets: () => ({ sets: [] }),
}));
vi.mock("../replayUserState", () => ({
  useReplayUserState: () => ({
    get: () => ({ provenance: null, tags: [], watched: false }),
    setWatched: () => {},
  }),
}));
vi.mock("../../downloads/config", () => ({
  useWriteRoot: () => ({}),
  useWriteRootPath: () => undefined,
}));
vi.mock("../../downloads/useQueuedDownload", () => ({
  useQueuedDownload: () => ({}),
}));
vi.mock("../../downloads/pages/components/ProgressBar", () => ({
  QueueProgress: () => null,
}));
vi.mock("../../mapconv/pages/components/MapPreview3D", () => ({
  MapPreview3D: () => null,
}));
vi.mock("./components/ReplayEventList", () => ({
  ReplayEventList: () => null,
}));
// The dock's metric lane needs the app's theme and the statistics, which
// `ReplayMetricLane.dom.test.tsx` covers.
vi.mock("./components/ReplayMetricLane", () => ({
  useMetricLane: () => null,
  MetricLaneLabel: () => null,
  MetricLanePlot: () => null,
}));
vi.mock("./components/MatchStatsSection", () => ({
  MatchStatsSection: () => null,
}));
vi.mock("./components/RefightPanel", () => ({ RefightPanel: () => null }));
vi.mock("./components/SendReplayToHub", () => ({
  SendReplayToHub: () => null,
}));
vi.mock("./components/RemixPanel", () => ({ RemixPanel: () => null }));
vi.mock("./components/ReplayBuildOrders", () => ({
  ReplayBuildOrders: () => null,
}));
vi.mock("./components/ReplayBaseCrops", () => ({
  BasePicturesProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../play/LaunchContentProvider", () => ({
  useLaunchContent: () => ({ ensureContent: async () => ({ ready: true }) }),
}));
vi.mock("../../play/PlayProvider", () => ({
  usePlay: () => ({ running: false, launchReplay: async () => ({}) }),
}));

const { default: ReplayDetailPage } = await import("./ReplayDetailPage");

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

function renderPage() {
  window.location.hash = `#/play/replays/${encodeURIComponent(FILE)}`;
  return render(
    <HashRouter>
      <Routes>
        <Route path="/play/replays/:name" element={<ReplayDetailPage />} />
      </Routes>
    </HashRouter>,
  );
}

const row = (name: string) =>
  within(screen.getByRole("link", { name }).closest("tr") as HTMLElement);

describe("the replay page and a faction picked in the match", () => {
  it("shows the picked faction, and the script's for a player who sent none", async () => {
    h.installed = true;
    renderPage();
    await vi.waitFor(() => row("Picker").getByText("Legion"));
    expect(row("Picker").queryByText("Armada")).toBeNull();
    row("Silent").getByText("Cortex");
  });

  it("keeps the script's side when the pick cannot be named", () => {
    h.installed = false;
    renderPage();
    row("Picker").getByText("Armada");
  });
});
