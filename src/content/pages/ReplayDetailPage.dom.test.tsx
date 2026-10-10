// @vitest-environment happy-dom
/**
 * The replay detail page reads the replay's file name from the route. The
 * replay list builds that route with `encodeURIComponent` and the router
 * decodes it once, so the page must look the file up by the parameter as it
 * comes. A second decode threw on a bare `%` and looked up the wrong file for
 * `%25` (#3422).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { HashRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The one replay file the list holds. Set by each test before it renders. */
let FILE = "";
/** The profile's `hide` list. Set by each test before it renders. */
let HIDE: string[] = [];
/** The parsed replay header. `null` until a test needs the loaded page. */
let INFO: object | null = null;
const LOADED_INFO = {
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
};
const NOT_FOUND = /isn't in the current scan/;

vi.mock("../config", () => ({
  invalidateMapPreview: () => {},
  useDemoInfo: () => ({ info: INFO, loading: false, error: null }),
  useReplays: () => ({
    replays: [
      {
        filename: FILE,
        path: `/replays/${FILE}`,
        sizeBytes: 1,
        modifiedMs: 0,
      },
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
  useReplayTarget: () => ({ resolved: null }),
}));
vi.mock("../useReplayEngine", () => ({
  useReplayEngine: () => ({
    watch: { kind: "direct" },
    notice: { kind: "none" },
  }),
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
vi.mock("../../profile/profile", async (orig) => ({
  ...(await orig<typeof import("../../profile/profile")>()),
  getProfile: () => ({ version: 1, hide: HIDE }),
}));
vi.mock("./components/MatchStatsSection", () => ({
  MatchStatsSection: () => <p>match stats section</p>,
}));
vi.mock("../../play/LaunchContentProvider", () => ({
  useLaunchContent: () => ({ ensureContent: async () => ({ ready: true }) }),
}));
vi.mock("../../play/PlayProvider", () => ({
  usePlay: () => ({ running: false, launchReplay: async () => ({}) }),
}));
vi.mock("./components/RefightPanel", () => ({ RefightPanel: () => null }));
vi.mock("./components/RemixPanel", () => ({ RemixPanel: () => null }));
vi.mock("./components/WatchButton", () => ({ WatchButton: () => null }));

const { default: ReplayDetailPage } = await import("./ReplayDetailPage");

afterEach(() => {
  HIDE = [];
  INFO = null;
  cleanup();
  window.location.hash = "";
});

const NAMES = [
  "%",
  "%25",
  "50% done.sdfz",
  "a#b.sdfz",
  "a?b.sdfz",
  "a/b.sdfz",
  "a b.sdfz",
  "a+b.sdfz",
  "Ünïcode 名前.sdfz",
];

function renderAt(name: string) {
  // The path every replay link builds.
  window.location.hash = `#/play/replays/${encodeURIComponent(name)}`;
  return render(
    <HashRouter>
      <Routes>
        <Route path="/play/replays/:name" element={<ReplayDetailPage />} />
      </Routes>
    </HashRouter>,
  );
}

describe("ReplayDetailPage", () => {
  it("reports a file that is not in the list (control)", () => {
    FILE = "other.sdfz";
    renderAt("missing.sdfz");
    expect(screen.getByText(NOT_FOUND)).toBeTruthy();
  });

  it.each(NAMES)("opens a replay file named %j", (name) => {
    FILE = name;
    renderAt(name);
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(name);
  });

  it("shows the match statistics section by default", () => {
    FILE = "a.sdfz";
    INFO = LOADED_INFO;
    renderAt("a.sdfz");
    expect(screen.queryByText("match stats section")).not.toBeNull();
  });

  it("hides the match statistics section when the profile hides it", () => {
    FILE = "a.sdfz";
    HIDE = ["analytics.matchStats"];
    INFO = LOADED_INFO;
    renderAt("a.sdfz");
    expect(screen.queryByText("match stats section")).toBeNull();
  });
});
