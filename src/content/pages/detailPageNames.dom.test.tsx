// @vitest-environment happy-dom
/**
 * Every library detail page reads its subject's name from the route. Links
 * encode that name once and the router decodes it once, so a page must use the
 * route parameter as it comes. A second `decodeURIComponent` throws on a bare
 * `%` and looks up the wrong name for `%25` (#3422).
 *
 * Each page is rendered at its real route, reached by the path its links build.
 * The scan holds one game, one map and one archive, all called `NAME`. A page
 * that cannot find its subject shows the "isn't in the current scan" notice.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { HashRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const SELECTED = {
  enginePath: "/engines/105",
  rootPath: "/data",
  engineId: "105",
  engineVersion: "105",
};

/** The name every fixture carries. Set by each test before it renders. */
let NAME = "";
/** The one unit the game's dataset holds, besides `unit`. */
let UNIT = "unit";
const UNIT_MISSING = /not in this game/i;
const NOT_FOUND = /isn't in the current scan/;

const archiveOf = (name: string) => ({
  name,
  path: `/data/${name}`,
  kind: "other",
  primary: false,
});

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (_key: string, fallback: unknown) => [fallback, () => {}],
  useDrawer: () => ({ open: () => {}, close: () => {}, isOpen: false }),
}));

vi.mock("../config", () => {
  const scan = () => ({
    data: {
      games: [
        {
          name: NAME,
          primaryArchive: archiveOf(NAME),
          dependencyArchives: [],
          info: {},
        },
      ],
      maps: [
        {
          name: NAME,
          archives: [archiveOf(NAME)],
          info: {},
        },
      ],
      errors: [],
    },
    loading: false,
    error: null,
    run: () => {},
  });
  const none = () => ({});
  return {
    classifyArchive: () => ({ kind: "other", primary: false }),
    useArchives: () => ({
      archives: [archiveOf(NAME)],
      data: { games: [], maps: [], errors: [] },
      loading: false,
    }),
    useContentState: () => ({ state: { roots: [] } }),
    useReplayStats: () => ({ records: [], ingesting: false }),
    useScanTargetSelection: () => ({ selected: SELECTED }),
    useUnitsyncScan: scan,
    useUnitsyncGameInfo: () => ({
      info: {
        sides: [],
        unitCount: 0,
        units: [],
        options: [],
        errors: [],
      },
      loading: false,
    }),
    useUnitsyncUnitDataset: () => ({
      dataset: { units: [{ name: "unit" }, { name: UNIT }], errors: [] },
      status: "ready",
    }),
    useUnitsyncUnitBuildpics: () => null,
    useUnitsyncUnitModel: () => ({ model: null, loading: false, failed: false }),
    useUnitsyncArchiveTree: () => ({ tree: null, loading: false }),
    useUnitsyncArchiveFile: () => ({ data: null, loading: false }),
    useUnitsyncThumbnails: () => ({ thumbs: new Map() }),
    useUnitsyncMapMeta: () => ({ meta: new Map() }),
    useUnitsyncMinimap: () => ({ startPositions: [] }),
    useUnitsyncHeightmap: none,
    useUnitsyncMapInfo: none,
    useUnitsyncMapSkybox: none,
  };
});

// Everything below is stubbed because it bears on neither the name lookup nor
// the notice. Each is a child component or a hook that needs a Tauri context.
vi.mock("./components/BuildTreeDrawer", () => ({ BuildTreeDrawer: () => null }));
vi.mock("./components/GameHeader", () => ({ GameHeader: () => null }));
vi.mock("./components/StartModeActions", () => ({
  StartModeActions: () => null,
}));
vi.mock("./components/MissionRuntimeSection", () => ({
  MissionRuntimeSection: () => null,
}));
vi.mock("@/blueprint/pages/components/GameEquivalents", () => ({
  GameEquivalents: () => null,
}));
vi.mock("./components/LuaRepl", () => ({ LuaRepl: () => null }));
vi.mock("./components/ArchiveTree", () => ({ ArchiveTree: () => null }));
vi.mock("./components/FilePreview", () => ({ FilePreview: () => null }));
vi.mock("./components/Convert3doDrawer", () => ({
  Convert3doDrawer: () => null,
}));
vi.mock("./components/LuaConsoleDrawer", () => ({
  LuaConsoleDrawer: () => null,
}));
vi.mock("../../mapconv/pages/components/MapPreview3D", () => ({
  MapPreview3D: () => null,
}));
vi.mock("../../play/pages/components/MapOverlay", () => ({
  useMapOverlayLayer: () => ({}),
  MapOverlayControls: () => null,
  MapOverlayLegend: () => null,
}));
vi.mock("../mapEligibility", () => ({
  useMapEligibility: () => ({
    verdictFor: () => null,
    setPlayerExcluded: () => {},
  }),
}));
vi.mock("../usePlayMap", () => ({ usePlayMap: () => () => {} }));
vi.mock("../usePlayGame", () => ({ usePlayGame: () => () => {} }));
vi.mock("../branding", () => ({ useBrandingEntry: () => null }));
vi.mock("@/factions/logos", () => ({ useFactionLogos: () => ({}) }));
vi.mock("@/profile/hidden", () => ({ isProfileHidden: () => true }));
vi.mock("@/general/advanced", () => ({ useAdvancedMode: () => false }));
vi.mock("../replayUserState", () => ({
  useReplayUserState: () => ({ state: null }),
  refightFilenames: () => [],
}));
vi.mock("@/workshop/config", () => ({
  useUnitDefs: () => ({
    defs: { units: {}, weaponDefs: {} },
    status: "ready",
    error: null,
    reload: () => {},
  }),
}));

const { default: ArchiveDetailPage } = await import("./ArchiveDetailPage");
const { default: ArchiveReplPage } = await import("./ArchiveReplPage");
const { default: GameDetailPage } = await import("./GameDetailPage");
const { default: GameUnitPage } = await import("./GameUnitPage");
const { default: GameUnitsPage } = await import("./GameUnitsPage");
const { default: MapDetailPage } = await import("./MapDetailPage");
const { default: UnitReferencePage } = await import("./UnitReferencePage");
const { PersistentStoreProvider } = await import("@picoframe/frame");
const { memorySettingsStorage } = await import("@/lib/storedSetting");

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

/** Names to try. A `/` is encoded as `%2F` by every link, so it stays one segment. */
const NAMES = [
  "%",
  "%25",
  "50% done",
  "a#b",
  "a?b",
  "a/b",
  "a b",
  "a+b",
  "Ünïcode 名前",
];

const enc = encodeURIComponent;

interface PageCase {
  page: string;
  route: string;
  /** The path the page's own links build for `name`. */
  path: (name: string) => string;
  element: ReactElement;
}

const CASES: PageCase[] = [
  {
    page: "ArchiveDetailPage",
    route: "/library/archives/:name",
    path: (n) => `/library/archives/${enc(n)}`,
    element: <ArchiveDetailPage />,
  },
  {
    page: "ArchiveReplPage",
    route: "/library/archives/:name/repl",
    path: (n) => `/library/archives/${enc(n)}/repl`,
    element: <ArchiveReplPage />,
  },
  {
    page: "GameDetailPage",
    route: "/library/games/:name",
    path: (n) => `/library/games/${enc(n)}`,
    element: <GameDetailPage />,
  },
  {
    page: "GameUnitsPage",
    route: "/library/games/:name/units",
    path: (n) => `/library/games/${enc(n)}/units`,
    element: <GameUnitsPage />,
  },
  {
    page: "UnitReferencePage",
    route: "/library/games/:name/units/reference",
    path: (n) => `/library/games/${enc(n)}/units/reference`,
    element: <UnitReferencePage />,
  },
  {
    page: "MapDetailPage",
    route: "/library/maps/:name",
    path: (n) => `/library/maps/${enc(n)}`,
    element: <MapDetailPage />,
  },
];

function renderAt(path: string, route: string, element: ReactElement) {
  window.location.hash = `#${path}`;
  return render(
    <PersistentStoreProvider storage={memorySettingsStorage()}>
      <HashRouter>
        <Routes>
          <Route path={route} element={element} />
        </Routes>
      </HashRouter>
    </PersistentStoreProvider>,
  );
}

describe.each(CASES)("$page", ({ route, path, element }) => {
  it("reports a name that is not in the scan (control)", () => {
    NAME = "Something else";
    renderAt(path("missing"), route, element);
    expect(screen.getByText(NOT_FOUND)).toBeTruthy();
  });

  it.each(NAMES)("opens %j", (name) => {
    NAME = name;
    renderAt(path(name), route, element);
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
  });
});

describe("GameUnitPage", () => {
  const route = "/library/games/:name/units/:unit";
  const path = (game: string, unit: string) =>
    `/library/games/${enc(game)}/units/${enc(unit)}`;

  it("reports a unit that is not in the dataset (control)", () => {
    NAME = "Game";
    UNIT = "unit";
    renderAt(path("Game", "missing"), route, <GameUnitPage />);
    expect(screen.getByText(UNIT_MISSING)).toBeTruthy();
  });

  it.each(NAMES)("opens a game named %j", (name) => {
    NAME = name;
    UNIT = "unit";
    renderAt(path(name, "unit"), route, <GameUnitPage />);
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
  });

  it.each(NAMES)("opens a unit named %j", (unit) => {
    NAME = "Game";
    UNIT = unit;
    renderAt(path("Game", unit), route, <GameUnitPage />);
    expect(screen.queryByText(UNIT_MISSING)).toBeNull();
  });
});
