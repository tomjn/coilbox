// @vitest-environment happy-dom
/**
 * Issue #1143. The roster beside the chart: a checkbox per team and per side that
 * narrow the chart, a column per registry metric, APM and rating per player, and
 * sorting by a column. Rendered with the real chart so the property that matters
 * is checked where it happens: unchecking a team removes its line and repaints
 * nobody. recharts is replaced by a stub that prints each real line, because it
 * draws nothing without a measured container.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DemoInfo,
  DemoTrailer,
  Metric,
  MetricKey,
  TeamStatSample,
} from "../../bindings";

let HIDE: string[] = [];
const trailerRead = vi.fn();
let TRAILER: DemoTrailer;
let METRICS: Metric[] = [];

vi.mock("../../../profile/profile", async (orig) => ({
  ...(await orig<typeof import("../../../profile/profile")>()),
  getProfile: () => ({ version: 1, hide: HIDE }),
}));
vi.mock("../../bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("../../bindings");
  return {
    ...actual,
    contentReplayTrailer: (a: unknown) => {
      trailerRead(a);
      return Promise.resolve({ trailer: TRAILER });
    },
    contentMetricRegistry: () => Promise.resolve({ metrics: METRICS }),
  };
});
vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useTheme: () => ({ resolved: "dark" }),
}));
vi.mock("../../usePrimaryPlayer", () => ({ usePrimaryPlayer: () => "" }));
vi.mock("recharts", () => {
  const Wrap = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Nothing = () => null;
  return {
    ResponsiveContainer: Wrap,
    LineChart: Wrap,
    // Only a real line has a name. The halo and the hit lines do not.
    Line: (p: { dataKey: string; stroke: string; name?: string }) =>
      p.name ? (
        <i data-line={p.dataKey} data-stroke={p.stroke} data-name={p.name} />
      ) : null,
    CartesianGrid: Nothing,
    Legend: Nothing,
    Tooltip: Nothing,
    XAxis: Nothing,
    YAxis: Nothing,
    usePlotArea: () => undefined,
    useXAxisScale: () => undefined,
    useYAxisScale: () => undefined,
  };
});

const { ReplayRoster } = await import("./ReplayRoster");
const { MatchStatsSection } = await import("./MatchStatsSection");
const { SeriesEmphasisProvider } = await import("../../useSeriesEmphasis");
const { isProfileHidden } = await import("../../../profile/hidden");
const { REPLAY_SOURCE_NOTES } = await import("../../replaySources");

/** No metric is named here: `metricRegistry.test.ts` forbids it. */
function sample(frame: number): TeamStatSample {
  return {
    frame,
    metalUsed: 0,
    energyUsed: 0,
    metalProduced: 0,
    energyProduced: 0,
    metalExcess: 0,
    energyExcess: 0,
    metalReceived: 0,
    energyReceived: 0,
    metalSent: 0,
    energySent: 0,
    damageDealt: 0,
    damageReceived: 0,
    unitsProduced: 0,
    unitsDied: 0,
    unitsReceived: 0,
    unitsSent: 0,
    unitsCaptured: 0,
    unitsOutCaptured: 0,
    unitsKilled: 0,
  };
}
const KEYS = Object.keys(sample(0)).filter((k) => k !== "frame") as MetricKey[];
const [ROSTER_A, ROSTER_B, NOT_ROSTER] = KEYS;

function metric(key: MetricKey, over: Partial<Metric> = {}): Metric {
  return {
    key,
    label: `Metric ${KEYS.indexOf(key)}`,
    group: "military",
    unit: "count",
    roster: true,
    headline: false,
    surfaced: true,
    ...over,
  };
}
const LABEL_A = `Metric ${KEYS.indexOf(ROSTER_A)}`;
const LABEL_B = `Metric ${KEYS.indexOf(ROSTER_B)}`;
const LABEL_NOT_ROSTER = `Metric ${KEYS.indexOf(NOT_ROSTER)}`;

/** Team figures at the end of the match, for the first roster metric. */
function trailerWith(finals: number[], samples = true): DemoTrailer {
  return {
    winningAllyTeams: [],
    teamStatPeriodSec: 15,
    teams: finals.map((final, team) => ({
      team,
      samples: samples
        ? [sample(0), { ...sample(450), [ROSTER_A]: final }]
        : [],
    })),
  };
}

const seat = (
  name: string,
  team: number,
  allyTeam: number,
  over: Record<string, unknown> = {},
) => ({
  name,
  team,
  allyTeam,
  spectator: false,
  rgbColor: [team / 4, 0.5, 0.5],
  ...over,
});

/** Two sides of two: Ann and Ben against Cat and Dan. */
function twoVTwo(over: Partial<DemoInfo> = {}): DemoInfo {
  return {
    players: [
      seat("Ann", 0, 0, { apm: 120, skill: "[µ=25.0, σ=8.3]" }),
      seat("Ben", 1, 0, { apm: 60 }),
      seat("Cat", 2, 1, { apm: 200 }),
      // Dan has no apm: the decoder gives none for uninitialised statistics.
      seat("Dan", 3, 1),
    ],
    ais: [],
    winnersKnown: false,
    winningAllyTeams: [],
    mapName: "Map",
    ...over,
  } as unknown as DemoInfo;
}

let path = 0;
function mount(info: DemoInfo, withSection = true) {
  const replayPath = `/replays/${++path}.sdfz`;
  const section = withSection && !isProfileHidden("analytics.matchStats");
  return render(
    <MemoryRouter>
      <SeriesEmphasisProvider>
        <ReplayRoster info={info} replayPath={replayPath} />
        {section && <MatchStatsSection info={info} replayPath={replayPath} />}
      </SeriesEmphasisProvider>
    </MemoryRouter>,
  );
}

const lines = () =>
  [...document.querySelectorAll<HTMLElement>("[data-line]")].map((l) => ({
    id: l.dataset.line,
    stroke: l.dataset.stroke,
    name: l.dataset.name,
  }));
const names = () => screen.getAllByRole("link").map((a) => a.textContent);
const box = (label: string) => screen.getByRole("checkbox", { name: label });

beforeEach(() => {
  localStorage.clear();
  METRICS = [
    metric(ROSTER_A, { headline: true }),
    metric(ROSTER_B),
    metric(NOT_ROSTER, { roster: false }),
  ];
  TRAILER = trailerWith([100, 900, 300, 50]);
});
afterEach(() => {
  cleanup();
  HIDE = [];
  vi.clearAllMocks();
});

describe("the roster as the chart's control", () => {
  it("unchecks a team: its line goes, nobody else is repainted", async () => {
    mount(twoVTwo());
    await waitFor(() => expect(lines()).toHaveLength(4));
    const before = lines();

    fireEvent.click(box("Show Ben on the chart"));

    await waitFor(() => expect(lines()).toHaveLength(3));
    const after = lines();
    expect(after.map((l) => l.name)).toEqual(["Ann", "Cat", "Dan"]);
    for (const l of after)
      expect(l.stroke).toBe(before.find((b) => b.id === l.id)?.stroke);
    expect(box("Show Ben on the chart").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("says in the export's tooltip that the file follows the checkboxes", async () => {
    mount(twoVTwo());
    await waitFor(() => expect(lines()).toHaveLength(4));
    const exportButton = () =>
      screen.getByRole("button", { name: /export csv/i });
    expect(exportButton().getAttribute("title")).toMatch(/nothing is hidden/i);
    fireEvent.click(box("Show Ben on the chart"));
    await waitFor(() =>
      expect(exportButton().getAttribute("title")).toMatch(/1 unchecked/),
    );
  });

  it("toggles every team of a side from the side's checkbox", async () => {
    mount(twoVTwo());
    await waitFor(() => expect(lines()).toHaveLength(4));
    const side = () => box("Show all of Team 1 on the chart");

    fireEvent.click(side());
    await waitFor(() =>
      expect(lines().map((l) => l.name)).toEqual(["Cat", "Dan"]),
    );
    expect(side().getAttribute("aria-checked")).toBe("false");

    fireEvent.click(side());
    await waitFor(() => expect(lines()).toHaveLength(4));
    expect(side().getAttribute("aria-checked")).toBe("true");
  });

  it("shows a side with only some of its teams on as indeterminate, and a press shows all", async () => {
    mount(twoVTwo());
    await waitFor(() => expect(lines()).toHaveLength(4));
    fireEvent.click(box("Show Ann on the chart"));
    const side = box("Show all of Team 1 on the chart");
    await waitFor(() =>
      expect(side.getAttribute("aria-checked")).toBe("mixed"),
    );

    fireEvent.click(side);
    await waitFor(() => expect(lines()).toHaveLength(4));
    expect(side.getAttribute("aria-checked")).toBe("true");
  });

  it("keeps a way back when every line is unchecked", async () => {
    mount(twoVTwo());
    await waitFor(() => expect(lines()).toHaveLength(4));
    fireEvent.click(box("Show all of Team 1 on the chart"));
    fireEvent.click(box("Show all of Team 2 on the chart"));
    await screen.findByText(/every line is unchecked/i);
    expect(lines()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    await waitFor(() => expect(lines()).toHaveLength(4));
  });

  it("highlights a team on the chart from the roster, and not one with no line", async () => {
    mount(twoVTwo());
    await waitFor(() => expect(lines()).toHaveLength(4));
    const press = screen.getByRole("button", {
      name: "Highlight Cat on the chart",
    });
    fireEvent.click(press);
    expect(press.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(box("Show Cat on the chart"));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Highlight Cat on the chart" }),
      ).toBeNull(),
    );
  });
});

describe("the figures", () => {
  it("has a column per roster metric and none for a metric the registry does not flag", async () => {
    mount(twoVTwo(), false);
    expect(
      await screen.findByRole("columnheader", { name: new RegExp(LABEL_A) }),
    ).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: new RegExp(LABEL_B) }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("columnheader", {
        name: new RegExp(LABEL_NOT_ROSTER),
      }),
    ).toBeNull();
  });

  it("shows each team's final total once, even for a team two people share", async () => {
    const info = twoVTwo({
      players: [
        seat("Ann", 0, 0, { apm: 120 }),
        seat("Ben", 0, 0, { apm: 60 }),
        seat("Cat", 1, 1, { apm: 200 }),
      ] as unknown as DemoInfo["players"],
    });
    TRAILER = trailerWith([4321, 77]);
    mount(info, false);
    await screen.findAllByRole("columnheader", { name: new RegExp(LABEL_A) });
    expect(screen.getAllByText("4,321")).toHaveLength(1);
    // Both people are on the one row, each with their own APM.
    const row = screen.getByText("Ann").closest("tr") as HTMLElement;
    expect(within(row).getByText("Ben")).toBeTruthy();
    expect(within(row).getByText("120")).toBeTruthy();
    expect(within(row).getByText("60")).toBeTruthy();
  });

  it("shows no APM for a player the decoder gave none, and a dash for them", async () => {
    mount(twoVTwo(), false);
    await screen.findAllByRole("columnheader", { name: new RegExp(LABEL_A) });
    const dan = screen.getByText("Dan").closest("tr") as HTMLElement;
    // No checkboxes without the chart, so cells and headers line up.
    const at = screen
      .getAllByRole("columnheader")
      .findIndex((h) => /apm/i.test(h.textContent ?? ""));
    expect(within(dan).getAllByRole("cell")[at].textContent).toBe("—");
  });

  it("shows the rating with the file's own text and the caveat in its tooltip", async () => {
    mount(twoVTwo(), false);
    const badge = await screen.findByRole("img", { name: /rating 25/i });
    expect(badge.textContent).toBe("25");
    const tip = badge.getAttribute("title") ?? "";
    expect(tip).toMatch(
      /rating the lobby recorded for its declared game mode/i,
    );
    expect(tip).toContain("[µ=25.0, σ=8.3]");
    // A rating with no uncertainty in the file says nothing about one.
    expect(tip).not.toMatch(/uncertainty/i);
  });

  it("adds the uncertainty the file recorded, as written, to the tooltip", async () => {
    mount(
      twoVTwo({
        players: [
          seat("Ann", 0, 0, {
            skill: "[25.06]",
            skillUncertainty: 2.65,
          }),
          seat("Ben", 1, 0),
        ],
      } as Partial<DemoInfo>),
      false,
    );
    const badge = await screen.findByRole("img", { name: /rating 25/i });
    const tip = badge.getAttribute("title") ?? "";
    expect(tip).toContain("uncertainty of 2.65");
    expect(tip).toMatch(
      /rating the lobby recorded for its declared game mode/i,
    );
  });
});

describe("sorting", () => {
  it("orders the rows by a column and marks only that column", async () => {
    mount(twoVTwo(), false);
    const header = await screen.findByRole("columnheader", {
      name: new RegExp(LABEL_A),
    });
    expect(header.getAttribute("aria-sort")).toBe("none");
    expect(names()).toEqual(["Ann", "Ben", "Cat", "Dan"]);

    fireEvent.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).toBe("descending");
    expect(names()).toEqual(["Ben", "Cat", "Ann", "Dan"]);
    expect(
      screen
        .getByRole("columnheader", { name: new RegExp(LABEL_B) })
        .getAttribute("aria-sort"),
    ).toBe("none");
  });

  it("flips to smallest first, then restores the grouped order", async () => {
    mount(twoVTwo(), false);
    const header = await screen.findByRole("columnheader", {
      name: new RegExp(LABEL_A),
    });
    const press = () => fireEvent.click(within(header).getByRole("button"));
    press();
    press();
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    expect(names()).toEqual(["Dan", "Ann", "Cat", "Ben"]);
    press();
    expect(header.getAttribute("aria-sort")).toBe("none");
    expect(names()).toEqual(["Ann", "Ben", "Cat", "Dan"]);
  });

  it("drops the side header rows while sorted, names the side on each row, and keeps a side checkbox", async () => {
    mount(twoVTwo());
    const header = await screen.findByRole("columnheader", {
      name: new RegExp(LABEL_A),
    });
    await waitFor(() => expect(lines()).toHaveLength(4));
    expect(screen.queryByRole("columnheader", { name: "Side" })).toBeNull();

    fireEvent.click(within(header).getByRole("button"));
    expect(screen.getByRole("columnheader", { name: "Side" })).toBeTruthy();
    const ben = screen.getByText("Ben").closest("tr") as HTMLElement;
    expect(within(ben).getByText("Team 1")).toBeTruthy();
    // The box that was in the side's header row is above the table now.
    fireEvent.click(screen.getByRole("checkbox", { name: "Team 1" }));
    await waitFor(() =>
      expect(lines().map((l) => l.name)).toEqual(["Cat", "Dan"]),
    );
  });

  it("puts a team with no value last whichever way it runs", async () => {
    // Team 3 has no samples, so no total.
    TRAILER = {
      ...trailerWith([100, 900, 300, 50]),
      teams: trailerWith([100, 900, 300, 50]).teams.map((t) =>
        t.team === 3 ? { ...t, samples: [] } : t,
      ),
    };
    mount(twoVTwo(), false);
    const header = await screen.findByRole("columnheader", {
      name: new RegExp(LABEL_A),
    });
    const press = () => fireEvent.click(within(header).getByRole("button"));
    press();
    expect(names().at(-1)).toBe("Dan");
    press();
    expect(names().at(-1)).toBe("Dan");
  });

  it("sorts by APM too, with a player who has none last", async () => {
    mount(twoVTwo(), false);
    const header = await screen.findByRole("columnheader", { name: /apm/i });
    fireEvent.click(within(header).getByRole("button"));
    expect(names()).toEqual(["Cat", "Ann", "Ben", "Dan"]);
  });
});

describe("with nothing to show", () => {
  it("is the roster as it was for a replay with no samples: no metric columns, no checkboxes", async () => {
    TRAILER = trailerWith([0, 0, 0, 0], false);
    mount(twoVTwo());
    await waitFor(() => expect(trailerRead).toHaveBeenCalled());
    await screen.findByText(/this replay has no statistics/i);
    expect(
      screen.queryByRole("columnheader", { name: new RegExp(LABEL_A) }),
    ).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    // The seats are all still there, with their APM and rating.
    expect(names()).toEqual(["Ann", "Ben", "Cat", "Dan"]);
    expect(screen.getByRole("columnheader", { name: /apm/i })).toBeTruthy();
    expect(screen.getByRole("img", { name: /rating 25/i })).toBeTruthy();
  });

  it("with the profile hiding match statistics: no checkboxes, columns or APM, and the rating stays", async () => {
    HIDE = ["analytics.matchStats"];
    mount(twoVTwo());
    await screen.findByText("Ann");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      screen.queryByRole("columnheader", { name: new RegExp(LABEL_A) }),
    ).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /apm/i })).toBeNull();
    expect(screen.getByRole("img", { name: /rating 25/i })).toBeTruthy();
    // Nothing was asked of the replay file either.
    expect(trailerRead).not.toHaveBeenCalled();
    // So the roster claims the setup as its only source.
    expect(screen.getByText(REPLAY_SOURCE_NOTES.setup)).toBeTruthy();
    expect(screen.queryByText(REPLAY_SOURCE_NOTES.players)).toBeNull();
  });

  it("says where the roster and the statistics section get their figures", async () => {
    mount(twoVTwo());
    await screen.findByText(REPLAY_SOURCE_NOTES.players);
    expect(
      await screen.findByText(
        `${REPLAY_SOURCE_NOTES.trailer} Figures are sampled every 15 seconds.`,
      ),
    ).toBeTruthy();
  });
});
