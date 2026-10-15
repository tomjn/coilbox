// @vitest-environment happy-dom
/**
 * The commands per minute chart (#1149): what stays in the page, and what the
 * section's help says (#3889).
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DemoCommandRates, DemoInfo } from "../../bindings";
import type { ChartSeries } from "../../matchStats";

let RATES: DemoCommandRates;

vi.mock("../../bindings", async (orig) => ({
  ...(await orig<typeof import("../../bindings")>()),
  contentDemoCommandRates: vi.fn(async () => RATES),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

const { CommandRateChart } = await import("./CommandRateChart");
const { resetReplayCommandRates } = await import("../../useReplayCommandRates");
const { SeriesEmphasisProvider } = await import("../../useSeriesEmphasis");

const INFO = {
  players: [{ name: "Ann", team: 0, allyTeam: 0, spectator: false }],
  ais: [],
  allyTeams: [{ id: 0 }],
} as unknown as DemoInfo;

const SERIES = [
  { id: "team-0", label: "Ann", color: "#ff0000", samples: [] },
] as unknown as ChartSeries[];

const rates = (over: Partial<DemoCommandRates> = {}): DemoCommandRates => ({
  periodSec: 15,
  periodIsDefault: true,
  buckets: 4,
  series: [{ team: 0, source: "selection", counts: [3, 4, 5, 6] }],
  pregame: 2,
  trailing: 7,
  unattributed: 1,
  lastFrame: 100,
  incomplete: false,
  ...over,
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  resetReplayCommandRates();
});

async function show() {
  render(
    <SeriesEmphasisProvider>
      <CommandRateChart
        info={INFO}
        replayPath="/replays/a.sdfz"
        series={SERIES}
        endSec={60}
      />
    </SeriesEmphasisProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Show commands per minute" }),
  );
  await screen.findByRole("radio", { name: "Player's own" });
}

describe("CommandRateChart", () => {
  it("has none of its explanation in the page until the help is opened", async () => {
    RATES = rates();
    await show();
    for (const said of [
      /One order is one command/,
      /orders in the last part-period are left out/,
      /orders before the game started are left out/,
      /orders from players with no team are left out/,
      /actions per minute counts these/,
    ]) {
      expect(screen.queryByText(said)).toBeNull();
    }
    fireEvent.click(
      screen.getByRole("button", { name: "About commands per minute" }),
    );
    const said = within(screen.getByRole("dialog"));
    expect(said.getByText(/One order is one command/)).toBeTruthy();
    expect(
      said.getByText(/The replay named no period, so the engine's default/),
    ).toBeTruthy();
    expect(
      said.getByText(/7 orders in the last part-period are left out/),
    ).toBeTruthy();
    expect(
      said.getByText(/2 orders before the game started are left out/),
    ).toBeTruthy();
    expect(
      said.getByText(/1 orders from players with no team are left out/),
    ).toBeTruthy();
    expect(said.getByText(/actions per minute counts these/)).toBeTruthy();
  });

  it("keeps the warning that the read stopped early in the page", async () => {
    RATES = rates({ incomplete: true });
    await show();
    expect(screen.getByText(/later orders may be missing/)).toBeTruthy();
  });

  it("keeps an empty state in the page, and offers no help for it", async () => {
    RATES = rates({ series: [] });
    render(
      <SeriesEmphasisProvider>
        <CommandRateChart
          info={INFO}
          replayPath="/replays/a.sdfz"
          series={SERIES}
          endSec={60}
        />
      </SeriesEmphasisProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show commands per minute" }),
    );
    await waitFor(() =>
      expect(screen.getByText(/holds no orders to count/)).toBeTruthy(),
    );
    expect(
      screen.queryByRole("button", { name: "About commands per minute" }),
    ).toBeNull();
  });
});
