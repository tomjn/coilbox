// @vitest-environment happy-dom
/**
 * Issue #3489: a replay whose game depends on an archive that is not installed
 * shows the banner and a disabled Watch that says why. A replay with nothing
 * missing shows neither.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { HashRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const FILE = "a.sdfz";

const h = vi.hoisted(() => ({
  missingDependencies: undefined as string[] | undefined,
}));

vi.mock("../config", () => ({
  invalidateMapPreview: () => {},
  useDemoInfo: () => ({
    info: {
      engineVersion: "",
      startTimeMs: 0,
      durationSec: 0,
      wallclockSec: 0,
      mapName: "Some Map",
      gameType: "Some Game",
      winningAllyTeams: [],
      winnersKnown: false,
      numAllyTeams: 0,
      allyTeams: [],
      players: [],
      ais: [],
      modOptions: {},
      mapOptions: {},
    },
    loading: false,
    error: null,
  }),
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
      games: [
        {
          name: "Some Game",
          info: {},
          primaryArchive: { name: "Some Game" },
          missingDependencies: h.missingDependencies,
        },
      ],
      maps: [{ name: "Some Map" }],
      errors: [],
    },
    loading: false,
    error: null,
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
vi.mock("./components/MatchStatsSection", () => ({
  MatchStatsSection: () => null,
}));
vi.mock("./components/RefightPanel", () => ({ RefightPanel: () => null }));
vi.mock("./components/RemixPanel", () => ({ RemixPanel: () => null }));
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

describe("the replay page and a missing dependency archive", () => {
  it("shows the banner and a disabled Watch that gives the reason", () => {
    h.missingDependencies = ["base-content"];
    renderPage();
    expect(
      screen.getAllByText(/Archive not installed: base-content\. Some Game/)
        .length,
    ).toBeGreaterThan(0);
    const watch = screen.getByRole("button", { name: "Watch" });
    expect((watch as HTMLButtonElement).disabled).toBe(true);
    expect(watch.getAttribute("title")).toMatch(
      /Archive not installed: base-content/,
    );
  });

  it("shows no banner and an enabled Watch when nothing is missing", () => {
    h.missingDependencies = undefined;
    renderPage();
    expect(screen.queryByText(/Archive not installed/)).toBeNull();
    const watch = screen.getByRole("button", { name: "Watch" });
    expect((watch as HTMLButtonElement).disabled).toBe(false);
  });
});
