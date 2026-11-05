// @vitest-environment happy-dom
/**
 * Issue #4735: a replay card names its figures from the Lingui catalog, not from
 * the English label the Rust registry publishes. The catalog here is a fixture,
 * not a real translation. The metric is the first one the label table has, so no
 * key is spelled out here (`metricRegistry.test.ts` forbids that).
 */
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Metric, ReplayFile, StatRecord } from "../bindings";
import { METRIC_LABEL } from "../metricLabels";

const KEY = Object.keys(METRIC_LABEL)[0] as Metric["key"];
const REGISTRY: Metric[] = [
  {
    key: KEY,
    label: "English from the registry",
    group: "military",
    unit: "damage",
    roster: true,
    headline: true,
    surfaced: true,
  },
];

const REPLAYS: ReplayFile[] = [
  {
    filename: "a.sdfz",
    path: "/replays/a.sdfz",
    sizeBytes: 1,
    modifiedMs: 1,
    mapName: "Map of a",
    durationSec: 600,
  },
];
const seat = (name: string, team: number) => ({
  name,
  team,
  allyTeam: team,
  spectator: false,
});
const RECORDS = [
  {
    filename: "a.sdfz",
    path: "/replays/a.sdfz",
    statsKnown: true,
    players: [seat("Ann", 0), seat("Ben", 1)],
    ais: [],
    teamTotals: [{ team: 0, totals: { [KEY]: 10 } }],
  } as unknown as StatRecord,
];

vi.mock("../config", () => ({
  useContentState: () => ({ state: { roots: [] } }),
  useReplayStats: () => ({ records: RECORDS }),
  useReplays: () => ({
    replays: REPLAYS,
    loading: false,
    error: null,
    ready: true,
    refresh: async () => {},
  }),
  useScanTargetSelection: () => ({
    targets: [],
    selected: null,
    selectedKey: "",
    setSelectedKey: () => {},
  }),
  useUnitsyncThumbnails: () => ({ thumbs: new Map(), loading: false }),
}));
vi.mock("../useReplaysRoot", () => ({ useReplaysRoot: () => "/replays" }));
vi.mock("../useMetricRegistry", () => ({ useMetricRegistry: () => REGISTRY }));
vi.mock("./components/BrowserToolbar", () => ({ BrowserToolbar: () => null }));
vi.mock("./components/GatherReplaysButton", () => ({
  GatherReplaysButton: () => null,
}));
vi.mock("./components/MapThumb", () => ({ MapThumb: () => null }));

const { PersistentStoreProvider } = await import("@picoframe/frame");
const { memorySettingsStorage } = await import("@/lib/storedSetting");
const { default: ReplaysPage } = await import("./ReplaysPage");

function fixtureCatalog() {
  return { [METRIC_LABEL[KEY].id as string]: "Fixture metric name" };
}

function renderPage() {
  render(
    <I18nProvider i18n={i18n}>
      <PersistentStoreProvider storage={memorySettingsStorage()}>
        <MemoryRouter>
          <ReplaysPage />
        </MemoryRouter>
      </PersistentStoreProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("a replay card's metric name", () => {
  it("shows the catalog's translation", () => {
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    renderPage();
    expect(screen.getByText("Fixture metric name")).toBeTruthy();
    expect(screen.queryByText("English from the registry")).toBeNull();
  });

  it("shows the table's English when the catalog has no translation", () => {
    renderPage();
    expect(screen.getByText(METRIC_LABEL[KEY].message as string)).toBeTruthy();
    expect(screen.queryByText("English from the registry")).toBeNull();
  });

  it("follows a language change while mounted", async () => {
    renderPage();
    expect(screen.queryByText("Fixture metric name")).toBeNull();
    await act(async () => {
      i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    });
    expect(screen.getByText("Fixture metric name")).toBeTruthy();
  });
});
