// @vitest-environment happy-dom
/**
 * Issue #3475: when a replay's header names no engine version, the page says
 * which engine Watch will use. A folder name is not a version (#3405, #3452),
 * so the hint prints only a version the engine reported, and says plainly when
 * the engine has not reported one.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { HashRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const FILE = "a.sdfz";
const FOLDER = "folder-name-105";
const REPORTED = "105.1.1-2511-gabc1234";

const h = vi.hoisted(() => ({
  target: {} as Record<string, unknown>,
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
  useUnitsyncScan: () => ({ data: null, loading: false, error: null }),
  useUnitsyncHeightmap: () => ({}),
  useUnitsyncMapSkybox: () => ({}),
  useUnitsyncMinimap: () => ({ startPositions: [] }),
}));
vi.mock("../useReplaysRoot", () => ({ useReplaysRoot: () => "/replays" }));
vi.mock("../../play/config", () => ({
  useReplayTarget: () => ({
    resolved: { target: h.target, matched: false },
  }),
}));
vi.mock("../useReplayEngine", () => ({
  useReplayEngine: () => ({
    watch: { kind: "fallback" },
    notice: { kind: "none" },
  }),
}));
vi.mock("../replaySets", () => ({
  useReplaySets: () => ({ sets: [] }),
}));
vi.mock("../replayUserState", () => ({
  useReplayUserState: () => ({
    get: () => ({ provenance: null, tags: [], watched: false }),
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
vi.mock("./components/ReplayBuildOrders", () => ({
  ReplayBuildOrders: () => null,
}));
vi.mock("./components/WatchButton", () => ({ WatchButton: () => null }));

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

describe("the hint for a replay whose header names no engine version", () => {
  it("does not show an unverified engine's folder name as a version", () => {
    // `engineVersion` is the folder name until the engine reports a version.
    h.target = { engineVersion: FOLDER, syncVersion: undefined };
    renderPage();
    const hint = screen.getByText(/may not sync/).textContent ?? "";
    expect(hint).toMatch(/has not had its version checked yet/);
    expect(hint).not.toMatch(new RegExp(`watching with ${FOLDER}`, "i"));
  });

  it("shows the version a verified engine reported", () => {
    h.target = { engineVersion: REPORTED, syncVersion: REPORTED };
    renderPage();
    const hint = screen.getByText(/may not sync/).textContent ?? "";
    expect(hint).toMatch(new RegExp(`watching with ${REPORTED}`, "i"));
    expect(hint).not.toMatch(/has not had its version checked yet/);
  });
});
