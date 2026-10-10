// @vitest-environment happy-dom
/**
 * The player dossier reads the player's name from the route. The replay page
 * links to it with `encodeURIComponent` and the router decodes it once, so the
 * page must show the parameter as it comes. A second decode threw on a bare
 * `%` and showed the wrong name for `%25` (#3422).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { HashRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Metric, StatRecord } from "../bindings";

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (_key: string, fallback: unknown) => [fallback, () => {}],
}));
let RECORDS: StatRecord[] = [];
let HIDE: string[] = [];
const METRICS = ["alpha", "beta"].map((key, i) => ({
  key,
  label: `Metric ${key}`,
  group: "military",
  unit: "count",
  roster: true,
  headline: i === 0,
  surfaced: true,
})) as Metric[];

vi.mock("../../profile/profile", async (orig) => ({
  ...(await orig<typeof import("../../profile/profile")>()),
  getProfile: () => ({ version: 1, hide: HIDE }),
}));
vi.mock("../useMetricRegistry", () => ({
  useMetricRegistry: (enabled = true) => (enabled ? METRICS : []),
}));
vi.mock("../config", () => ({
  useContentState: () => ({ state: { roots: [] } }),
  useReplayStats: () => ({ records: RECORDS, ingesting: false, error: null }),
  useScanTargetSelection: () => ({ selected: null }),
}));
vi.mock("../replayUserState", () => ({
  useReplayUserState: () => ({ state: null }),
  refightFilenames: () => new Set<string>(),
}));

const { default: PlayerDossierPage } = await import("./PlayerDossierPage");

afterEach(() => {
  cleanup();
  window.location.hash = "";
  RECORDS = [];
  HIDE = [];
});

function played(
  filename: string,
  startTimeMs: number,
  won: boolean,
  withTotals: boolean,
): StatRecord {
  return {
    filename,
    path: filename,
    mapName: "Map",
    gameType: "Game",
    durationSec: 600,
    startTimeMs,
    winnersKnown: true,
    winningAllyTeams: [],
    remixed: false,
    ais: [],
    statsKnown: withTotals,
    players: [{ name: "Ann", team: 0, spectator: false, won }],
    teamTotals: withTotals ? [{ team: 0, totals: { alpha: 6000 } }] : [],
  } as unknown as StatRecord;
}

function renderAnn() {
  window.location.hash = "#/stats/Ann";
  render(
    <HashRouter>
      <Routes>
        <Route path="/stats/:name" element={<PlayerDossierPage />} />
      </Routes>
    </HashRouter>,
  );
}

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

describe("PlayerDossierPage", () => {
  it.each(NAMES)("names a player called %j", (name) => {
    // The path the replay page's roster links build.
    window.location.hash = `#/stats/${encodeURIComponent(name)}`;
    render(
      <HashRouter>
        <Routes>
          <Route path="/stats/:name" element={<PlayerDossierPage />} />
        </Routes>
      </HashRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(name);
  });
});

describe("PlayerDossierPage match figures", () => {
  it("shows rates split by result, with the games each is drawn from", () => {
    RECORDS = [
      played("a", 1, true, true),
      played("b", 2, false, true),
      played("c", 3, true, false),
    ];
    renderAnn();
    expect(screen.getByText("Match figures per minute")).not.toBeNull();
    expect(screen.getByText(/Drawn from 2 of 3 games/)).not.toBeNull();
    expect(screen.getByText(/1 with no team totals/)).not.toBeNull();
    // 6000 over 10 minutes.
    expect(screen.getAllByText("600").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 game$/).length).toBeGreaterThan(0);
    expect(screen.getByText("Ann's team, per minute")).not.toBeNull();
  });

  it("says so, and shows no numbers, when no game has totals", () => {
    RECORDS = [played("a", 1, true, false), played("b", 2, false, false)];
    renderAnn();
    expect(
      screen.getByText(/None of Ann's 2 games has team totals recorded/),
    ).not.toBeNull();
    expect(screen.queryByText(/Drawn from/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("is hidden when the profile hides match statistics", () => {
    HIDE = ["analytics.matchStats"];
    RECORDS = [played("a", 1, true, true)];
    renderAnn();
    expect(screen.queryByText("Match figures per minute")).toBeNull();
  });
});
