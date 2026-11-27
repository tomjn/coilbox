// @vitest-environment happy-dom
/**
 * The replay detail page reads the replay's file name from the route. The
 * replay list builds that route with `encodeURIComponent` and the router
 * decodes it once, so the page must look the file up by the parameter as it
 * comes. A second decode threw on a bare `%` and looked up the wrong file for
 * `%25` (#3422).
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
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
  useUnitsyncGameInfo: () => ({ info: null, status: "idle" }),
  useUnitsyncHeightmap: () => ({}),
  useUnitsyncUnitDataset: () => ({ dataset: null, status: "idle" }),
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
vi.mock("../../profile/profile", async (orig) => ({
  ...(await orig<typeof import("../../profile/profile")>()),
  getProfile: () => ({ version: 1, hide: HIDE }),
}));
// The dock's metric lane needs the app's theme and the statistics, which
// `ReplayMetricLane.dom.test.tsx` covers.
vi.mock("./components/ReplayMetricLane", () => ({
  useMetricLane: () => null,
  MetricLaneLabel: () => null,
  MetricLanePlot: () => null,
}));
vi.mock("./components/MatchStatsSection", () => ({
  MatchStatsSection: ({ part }: { part: string }) => <p>match stats {part}</p>,
}));
vi.mock("../../play/LaunchContentProvider", () => ({
  useLaunchContent: () => ({ ensureContent: async () => ({ ready: true }) }),
}));
vi.mock("../../play/PlayProvider", () => ({
  usePlay: () => ({ running: false, launchReplay: async () => ({}) }),
}));
vi.mock("./components/RefightPanel", () => ({ RefightPanel: () => null }));
vi.mock("./components/RemixPanel", () => ({ RemixPanel: () => null }));
// What the awards say is `ReplayAwards.dom.test.tsx`'s. Here, where they sit.
vi.mock("./components/ReplayAwards", () => ({
  ReplayAwards: () => <p>awards section</p>,
}));
vi.mock("./components/ReplayBuildOrders", () => ({
  ReplayBuildOrders: () => <p>build orders section</p>,
}));
vi.mock("./components/ReplayBaseCrops", () => ({
  BasePicturesProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./components/ReplayEventList", () => ({
  ReplayEventList: ({ showAnalysis }: { showAnalysis: boolean }) => (
    <p>event list {showAnalysis ? "with analysis" : "without analysis"}</p>
  ),
}));
vi.mock("./components/WatchButton", () => ({ WatchButton: () => null }));
vi.mock("./components/WatchWithRewindButton", () => ({
  WatchWithRewindButton: () => null,
}));

const { default: ReplayDetailPage } = await import("./ReplayDetailPage");
const { resetReplayTracksForTests, seedReplayTracksForTests } = await import(
  "../replayTracks"
);

afterEach(() => {
  resetReplayTracksForTests();
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

function renderAt(name: string, search = "") {
  // The path every replay link builds.
  window.location.hash = `#/play/replays/${encodeURIComponent(name)}${search}`;
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
    expect(screen.queryByText("match stats tiles")).not.toBeNull();
    expect(screen.queryByText("match stats chart")).not.toBeNull();
    expect(screen.queryByText("build orders section")).not.toBeNull();
    expect(screen.queryByText("event list with analysis")).not.toBeNull();
    expect(
      screen.getByText("awards section").closest("[role=tabpanel]")?.id,
    ).toMatch(/summary$/);
  });

  it("hides the match statistics section when the profile hides it", () => {
    FILE = "a.sdfz";
    HIDE = ["analytics.matchStats"];
    INFO = LOADED_INFO;
    renderAt("a.sdfz");
    expect(screen.queryByText("match stats tiles")).toBeNull();
    expect(screen.queryByText("match stats chart")).toBeNull();
    expect(screen.queryByText("build orders section")).toBeNull();
    expect(screen.queryByText("awards section")).toBeNull();
    // The chat and player events are read from the file, so the list stays.
    expect(screen.queryByText("event list without analysis")).not.toBeNull();
  });

  describe("the panel's tabs (#5304)", () => {
    const tab = (name: string) => screen.getByRole("tab", { name });
    const selected = () =>
      screen
        .getAllByRole("tab")
        .filter((t) => t.getAttribute("aria-selected") === "true")
        .map((t) => t.textContent);
    /** Whether a section is in the open tab. The other tabs stay mounted and
     *  are hidden by their `data-state` in the stylesheet. */
    const shown = (text: string) =>
      screen
        .getByText(text)
        .closest("[role=tabpanel]")
        ?.getAttribute("data-state") === "active";

    it("opens on the Summary when the address names no tab", () => {
      FILE = "a.sdfz";
      INFO = LOADED_INFO;
      renderAt("a.sdfz");
      expect(selected()).toEqual(["Summary"]);
      expect(shown("match stats tiles")).toBe(true);
      expect(shown("match stats chart")).toBe(false);
    });

    it.each([
      ["economy", "Economy", "match stats chart"],
      ["builds", "Build orders", "build orders section"],
      ["events", "Events and chat", "event list with analysis"],
    ])("shows the %s tab the address names", (param, name, section) => {
      FILE = "a.sdfz";
      INFO = LOADED_INFO;
      renderAt("a.sdfz", `?tab=${param}`);
      expect(selected()).toEqual([name]);
      expect(shown(section)).toBe(true);
      expect(shown("match stats tiles")).toBe(false);
    });

    it("puts the chosen tab in the address and keeps the rest of it", () => {
      FILE = "a.sdfz";
      INFO = LOADED_INFO;
      renderAt("a.sdfz", "?frame=300");
      fireEvent.mouseDown(tab("Build orders"));
      expect(selected()).toEqual(["Build orders"]);
      const query = new URLSearchParams(window.location.hash.split("?")[1]);
      expect(query.get("tab")).toBe("builds");
      expect(query.get("frame")).toBe("300");

      fireEvent.mouseDown(tab("Summary"));
      expect(
        new URLSearchParams(window.location.hash.split("?")[1]).get("tab"),
      ).toBe("summary");
    });

    it("opens the Summary when the map card's Analyse replay is pressed from another tab", async () => {
      FILE = "a.sdfz";
      INFO = { ...LOADED_INFO, gameId: "00112233445566778899aabbccddeeff" };
      renderAt("a.sdfz", "?tab=events");
      expect(selected()).toEqual(["Events and chat"]);
      fireEvent.click(screen.getByRole("button", { name: "Analyse replay" }));
      await waitFor(() => expect(selected()).toEqual(["Summary"]));
    });

    it("opens on the Summary for a tab that is not one", () => {
      FILE = "a.sdfz";
      INFO = LOADED_INFO;
      renderAt("a.sdfz", "?tab=nonsense");
      expect(selected()).toEqual(["Summary"]);
    });

    it("does not list the tabs a distribution profile hides, and opens the Summary for one", () => {
      FILE = "a.sdfz";
      HIDE = ["analytics.matchStats"];
      INFO = LOADED_INFO;
      renderAt("a.sdfz", "?tab=economy");
      expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
        "Summary",
        "Events and chat",
      ]);
      expect(selected()).toEqual(["Summary"]);
    });
  });

  it("says whether the replay's track is current or out of date (#3786, #3788)", () => {
    const gameId = "00112233445566778899aabbccddeeff";
    FILE = "a.sdfz";
    INFO = { ...LOADED_INFO, gameId };
    const track = { gameId, sizeBytes: 1, lastWatchedMs: 1 };

    seedReplayTracksForTests([{ ...track, state: "current" }]);
    const first = renderAt("a.sdfz");
    expect(
      screen.queryByText(/^Recorded for rewind\. The track takes/),
    ).not.toBeNull();
    // The list's badge is not repeated on the page.
    expect(screen.queryByText("Track recorded")).toBeNull();
    first.unmount();

    seedReplayTracksForTests([{ ...track, state: "stale" }]);
    renderAt("a.sdfz");
    expect(
      screen.queryByText(/The recorded track is out of date/),
    ).not.toBeNull();
    expect(screen.queryByText("Track out of date")).toBeNull();
    expect(
      screen.queryByText(/^Recorded for rewind\. The track takes/),
    ).toBeNull();
  });

  it("has one map card beside the section that analyses and records, opening on Units with a recording and on Heat without (#5310)", async () => {
    const gameId = "00112233445566778899aabbccddeeff";
    FILE = "a.sdfz";
    INFO = { ...LOADED_INFO, gameId };

    const bare = renderAt("a.sdfz");
    expect(screen.queryByRole("region", { name: "Recorded match" })).toBeNull();
    await waitFor(() =>
      expect(
        screen
          .getByRole("radio", { name: "Heat" })
          .getAttribute("aria-checked"),
      ).toBe("true"),
    );
    expect(
      (screen.getByRole("radio", { name: "Units" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    screen.getByRole("button", { name: "Analyse replay" });
    bare.unmount();

    seedReplayTracksForTests([
      { gameId, sizeBytes: 1, lastWatchedMs: 1, state: "current" },
    ]);
    renderAt("a.sdfz");
    expect(screen.queryByRole("region", { name: "Recording" })).toBeNull();
    const recording = screen.getByRole("region", {
      name: "Analysis and recording",
    });
    const card = screen.getByRole("region", { name: "Map" });
    // The map is the left column and the section is in the panel on the right.
    expect(
      card.compareDocumentPosition(recording) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: "Units" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.queryByRole("button", { name: "Analyse replay" })).toBeNull();
    // The map is not a second section further down the page.
    expect(screen.getAllByRole("region", { name: "Map" })).toHaveLength(1);
  });
});
