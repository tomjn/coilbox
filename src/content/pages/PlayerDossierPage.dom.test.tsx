// @vitest-environment happy-dom
/**
 * The player dossier reads the player's name from the route. The replay page
 * links to it with `encodeURIComponent` and the router decodes it once, so the
 * page must show the parameter as it comes. A second decode threw on a bare
 * `%` and showed the wrong name for `%25` (#3422).
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { HashRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Metric, MetricRatio, StatRecord } from "../bindings";

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

const RATIOS = [
  {
    key: "gamma",
    label: "Alpha per beta",
    numerator: "alpha",
    denominator: "beta",
  },
] as unknown as MetricRatio[];

vi.mock("../../profile/profile", async (orig) => ({
  ...(await orig<typeof import("../../profile/profile")>()),
  getProfile: () => ({ version: 1, hide: HIDE }),
}));
vi.mock("../useMetricRegistry", () => ({
  useMetricRegistry: (enabled = true) => (enabled ? METRICS : []),
  useRatioRegistry: (enabled = true) => (enabled ? RATIOS : []),
}));
vi.mock("../config", () => ({
  useContentState: () => ({ state: { roots: [] } }),
  useReplayStats: () => ({ records: RECORDS, ingesting: false, error: null }),
  useScanTargetSelection: () => ({ selected: null }),
}));
// The units section reads replays through Rust. Here it has nothing to read.
vi.mock("../useUnitUsage", async () => {
  const { foldUnitUsage } =
    await vi.importActual<typeof import("../unitUsage")>("../unitUsage");
  return {
    useUnitUsage: (games: never[], name: string) => ({
      usage: foldUnitUsage(games, name, new Map(), new Set(), () => ({
        stream: { kind: "none" },
        events: null,
      })),
      reading: false,
      error: null,
    }),
  };
});
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

/** The figures section's help, opened. Call once per test. */
const help = () => {
  fireEvent.click(screen.getByRole("button", { name: "About match figures" }));
  return within(screen.getByRole("dialog"));
};

describe("PlayerDossierPage match figures", () => {
  it("shows rates split by result, with the games each is drawn from", () => {
    RECORDS = [
      played("a", 1, true, true),
      played("b", 2, false, true),
      played("c", 3, true, false),
    ];
    renderAnn();
    expect(screen.getByText("Match figures")).not.toBeNull();
    expect(screen.getByText(/Drawn from 2 of 3 games/)).not.toBeNull();
    expect(help().getByText(/1 with no figures recorded/)).not.toBeNull();
    // 6000 over 10 minutes.
    expect(screen.getAllByText("600").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 game$/).length).toBeGreaterThan(0);
    expect(screen.getByText("Ann's own figures, per minute")).not.toBeNull();
  });

  it("says so, and shows no numbers, when no game has totals", () => {
    RECORDS = [played("a", 1, true, false), played("b", 2, false, false)];
    renderAnn();
    expect(
      screen.getByText(/None of Ann's 2 games has figures recorded/),
    ).not.toBeNull();
    expect(screen.queryByText(/Drawn from/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("does not call a player's own figures a team when allies differ", () => {
    // Ann and Ben are allies on one side with separate engine teams, and their
    // totals differ. The replay page calls that side "Team 1".
    RECORDS = [
      {
        ...played("a", 1, true, true),
        players: [
          { name: "Ann", team: 0, allyTeam: 0, spectator: false, won: true },
          { name: "Ben", team: 1, allyTeam: 0, spectator: false, won: true },
        ],
        teamTotals: [
          { team: 0, totals: { alpha: 6000 } },
          { team: 1, totals: { alpha: 600 } },
        ],
      } as unknown as StatRecord,
    ];
    renderAnn();
    const section = screen
      .getByText("Match figures")
      .closest("section") as HTMLElement;
    expect(within(section).getAllByText("600").length).toBeGreaterThan(0);
    expect(within(section).queryByText("60")).toBeNull();
    expect(section.textContent).not.toMatch(/team/i);
    expect(section.textContent).toContain("Ann's own figures");
    expect(section.textContent).not.toContain("another player shared control");
  });

  it("says when players shared control of one army", () => {
    RECORDS = [
      {
        ...played("a", 1, true, true),
        players: [
          { name: "Ann", team: 0, allyTeam: 0, spectator: false, won: true },
          { name: "Ben", team: 0, allyTeam: 0, spectator: false, won: true },
        ],
      } as unknown as StatRecord,
    ];
    renderAnn();
    expect(
      help().getByText(/In 1 game another player shared control of Ann's army/),
    ).not.toBeNull();
  });

  it("keeps the explanation out of the section until the help is opened", () => {
    RECORDS = [
      played("a", 1, true, true),
      played("b", 2, false, true),
      played("c", 3, true, false),
    ];
    renderAnn();
    const moved = [
      /divided by the match's minutes/,
      /mean of each game's own rate/,
      /Only players who share control of one army/,
      /A game with no recorded result is in All only/,
      /cannot say how far ahead a player was/,
      /Left out:/,
    ];
    for (const said of moved) expect(screen.queryByText(said)).toBeNull();
    const dialog = help();
    for (const said of moved)
      expect(dialog.getAllByText(said).length).toBeGreaterThan(0);
  });

  it("keeps the game count and the empty state inline", () => {
    RECORDS = [played("a", 1, true, true), played("b", 2, false, false)];
    renderAnn();
    expect(screen.getByText("Drawn from 1 of 2 games.")).not.toBeNull();
    cleanup();
    RECORDS = [played("a", 1, true, false)];
    renderAnn();
    expect(
      screen.getByText(/None of Ann's 1 game has figures recorded/),
    ).not.toBeNull();
    expect(screen.queryByText(/Left out:/)).toBeNull();
  });

  it("is hidden when the profile hides match statistics", () => {
    HIDE = ["analytics.matchStats"];
    RECORDS = [played("a", 1, true, true)];
    renderAnn();
    expect(screen.queryByText("Match figures")).toBeNull();
    expect(screen.queryByText("Units ordered")).toBeNull();
  });

  it("shows the units section beside the figures when nothing hides it", () => {
    RECORDS = [played("a", 1, true, true)];
    renderAnn();
    expect(
      screen.getByRole("heading", { name: "Units ordered" }),
    ).not.toBeNull();
  });
});

describe("PlayerDossierPage ratio", () => {
  const withTotals = (
    filename: string,
    startTimeMs: number,
    won: boolean,
    alpha: number,
    beta: number,
  ): StatRecord =>
    ({
      ...played(filename, startTimeMs, won, true),
      teamTotals: [{ team: 0, totals: { alpha, beta } }],
    }) as unknown as StatRecord;

  const ratioRow = () =>
    screen.getByText("Alpha per beta").closest("tr") as HTMLElement;

  it("shows the ratio with its own game count, split by result, and never per minute", () => {
    RECORDS = [
      withTotals("a", 1, true, 10, 5),
      withTotals("b", 2, true, 30, 10),
      withTotals("c", 3, false, 8, 2),
    ];
    renderAnn();
    const row = within(ratioRow());
    // Wins 2 and 3 average to 2.5, losses are 4, and all three average to 3.
    expect(row.getAllByText("3").length).toBeGreaterThan(0);
    expect(row.getAllByText("2.5").length).toBeGreaterThan(0);
    expect(row.getAllByText("4").length).toBeGreaterThan(0);
    expect(row.getByText(/median 3 · 3 games/)).not.toBeNull();
    expect(row.getByText(/median 2.5 · 2 games/)).not.toBeNull();
    expect(row.getByText(/median 4 · 1 game$/)).not.toBeNull();
    expect(ratioRow().textContent).not.toMatch(/per minute/i);
    expect(
      screen.getByText("Ann's own figures, ratios with no unit"),
    ).not.toBeNull();
  });

  it("leaves a game with nothing underneath out of the average and counts it", () => {
    RECORDS = [
      withTotals("a", 1, true, 10, 5),
      withTotals("b", 2, true, 30, 0),
    ];
    renderAnn();
    const row = within(ratioRow());
    expect(
      row.getAllByText(/median 2 · 1 game · 1 with no metric beta/)[0],
    ).not.toBeNull();
    expect(ratioRow().textContent).not.toMatch(/Infinity|NaN/);
  });

  it("reads as a dash with a count when no game has anything underneath", () => {
    RECORDS = [
      withTotals("a", 1, true, 10, 0),
      withTotals("b", 2, false, 4, 0),
    ];
    renderAnn();
    const row = within(ratioRow());
    expect(row.getAllByText("—").length).toBeGreaterThan(0);
    expect(row.getByText(/^0 games · 2 with no metric beta$/)).not.toBeNull();
    expect(ratioRow().textContent).not.toMatch(/Infinity|NaN/);
  });

  it("is offered in the trend picker", () => {
    RECORDS = [withTotals("a", 1, true, 10, 5), withTotals("b", 2, true, 8, 2)];
    renderAnn();
    expect(
      screen.getByRole("combobox", { name: "Trend metric" }),
    ).not.toBeNull();
  });
});
