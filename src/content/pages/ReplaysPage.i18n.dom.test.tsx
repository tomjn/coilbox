// @vitest-environment happy-dom
/**
 * Issue #4601: the replay list's text comes out of the Lingui catalog. The
 * catalog here is a fixture, not a real translation. It renames the heading line
 * so a translated string can be told from the English
 * source.
 */
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Metric, ReplayFile, StatRecord } from "../bindings";

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
const REGISTRY: Metric[] = [];

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
    teamTotals: [],
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
  return {
    [msg`Demo files in your content folder.`.id]: "Fixture heading line",
  };
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

describe("the replay list's text", () => {
  it("shows the fixture catalog's heading line", () => {
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    renderPage();
    expect(screen.getByText("Fixture heading line")).toBeTruthy();
    expect(screen.queryByText("Demo files in your content folder.")).toBeNull();
  });

  it("stays in English when the catalog has no translation", () => {
    renderPage();
    expect(screen.getByText("Demo files in your content folder.")).toBeTruthy();
  });

  it("follows a language change while mounted", async () => {
    renderPage();
    expect(screen.getByText("Demo files in your content folder.")).toBeTruthy();
    await act(async () => {
      i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    });
    expect(screen.getByText("Fixture heading line")).toBeTruthy();
  });
});
