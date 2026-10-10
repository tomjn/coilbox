// @vitest-environment happy-dom
/**
 * Issue #3829: the replay list can show and sort its figures for the primary
 * player's own figures instead of the whole match. The metric key is made up,
 * because `metricRegistry.test.ts` forbids a real one outside the bindings.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Metric, ReplayFile, StatRecord } from "../bindings";

const file = (name: string): ReplayFile => ({
  filename: name,
  path: `/replays/${name}`,
  sizeBytes: 1,
  modifiedMs: 1,
  mapName: `Map of ${name}`,
  durationSec: 600,
});

const REPLAYS = ["a", "b", "c", "d"].map((n) => file(`${n}.sdfz`));

const ALPHA = "alpha" as Metric["key"];
const REGISTRY: Metric[] = [
  {
    key: ALPHA,
    label: "Alpha",
    group: "military",
    unit: "damage",
    roster: true,
    headline: false,
    surfaced: true,
  },
];

const seat = (name: string, team?: number) => ({
  name,
  team,
  allyTeam: team,
  spectator: false,
});
const record = (
  name: string,
  players: ReturnType<typeof seat>[],
  alphas: number[],
): StatRecord =>
  ({
    filename: `${name}.sdfz`,
    path: `/replays/${name}.sdfz`,
    statsKnown: true,
    players,
    ais: [],
    teamTotals: alphas.map((v, team) => ({ team, totals: { alpha: v } })),
  }) as unknown as StatRecord;

// Ann is the most frequent player, so she is the primary player.
//   a: Ann on team 0 (10), the other team 500
//   b: Ann on team 1 (30), the other team 5
//   c: an old record, Ann with no team id
//   d: Ann is not in it
const RECORDS = [
  record("a", [seat("Ann", 0), seat("Ben", 1)], [10, 500]),
  record("b", [seat("Cat", 0), seat("Ann", 1)], [5, 30]),
  record("c", [seat("Ann"), seat("Cat")], [20, 20]),
  record("d", [seat("Ben", 0), seat("Cat", 1)], [900, 100]),
];
let STORED: StatRecord[] = RECORDS;

vi.mock("../config", () => ({
  useContentState: () => ({ state: { roots: [] } }),
  useReplayStats: () => ({ records: STORED }),
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

let storage = memorySettingsStorage();

function renderPage() {
  return render(
    <PersistentStoreProvider storage={storage}>
      <MemoryRouter>
        <ReplaysPage />
      </MemoryRouter>
    </PersistentStoreProvider>,
  );
}

const order = () =>
  screen
    .queryAllByRole("link")
    .map((a) => a.textContent ?? "")
    .filter((t) => t.includes("Map of"))
    .map((t) => t.match(/Map of (\w)/)?.[1]);
const mineButton = () => screen.queryByRole("button", { name: "My figures" });
const sortBy = (dir: "asc" | "desc") =>
  storage.set(
    "content.replayFilters.sort",
    JSON.stringify(`metric:alpha:${dir}`),
  );

beforeEach(() => {
  storage = memorySettingsStorage();
  STORED = RECORDS;
});
afterEach(cleanup);

describe("the replay list's My figures switch", () => {
  it("is absent when nobody is known to be the primary player", () => {
    STORED = [];
    renderPage();
    expect(mineButton()).toBeNull();
  });

  it("sorts on the whole match until it is pressed", () => {
    sortBy("desc");
    renderPage();
    expect(order()).toEqual(["d", "a", "c", "b"]);
    expect(mineButton()?.getAttribute("aria-pressed")).toBe("false");
  });

  it("sorts on the primary player's own figures once pressed", async () => {
    sortBy("desc");
    renderPage();
    fireEvent.click(mineButton() as HTMLElement);
    await waitFor(() => expect(order()[0]).toBe("b"));
    // b is Ann's 30 and a is her 10. c is an old record with no team id and d
    // does not have her in it, so neither has a figure and both follow.
    expect(order().slice(0, 2)).toEqual(["b", "a"]);
    expect(order().slice(2).sort()).toEqual(["c", "d"]);
  });

  it("keeps the rows with no figure for her last when the sort flips", async () => {
    sortBy("asc");
    renderPage();
    fireEvent.click(mineButton() as HTMLElement);
    await waitFor(() => expect(order()[0]).toBe("a"));
    expect(order().slice(0, 2)).toEqual(["a", "b"]);
    expect(order().slice(2).sort()).toEqual(["c", "d"]);
  });

  it("does not call a player's own figures a team when allies differ", async () => {
    // Ann and Ben are allies on one side (ally team 0) with separate engine
    // teams, so their figures differ. The replay page calls that side "Team 1".
    STORED = [
      {
        ...record("a", [seat("Ann", 0), seat("Ben", 1)], [10, 500]),
        players: [
          { name: "Ann", team: 0, allyTeam: 0, spectator: false },
          { name: "Ben", team: 1, allyTeam: 0, spectator: false },
        ],
      } as unknown as StatRecord,
    ];
    renderPage();
    const button = mineButton() as HTMLElement;
    expect(button.textContent).not.toMatch(/team/i);
    expect(button.getAttribute("title")).not.toMatch(/team/i);
    expect(button.getAttribute("title")).toContain("Ann");
  });

  it("remembers the choice", () => {
    renderPage();
    fireEvent.click(mineButton() as HTMLElement);
    expect(storage.get("content.replayFilters.mine")).toBe("true");
  });

  it("falls back to the whole match when a saved choice has nobody to be about", () => {
    STORED = [];
    storage.set("content.replayFilters.mine", "true");
    sortBy("desc");
    renderPage();
    expect(mineButton()).toBeNull();
  });
});
