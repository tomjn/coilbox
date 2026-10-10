// @vitest-environment happy-dom
/**
 * The matchup page shows records as counts and links each game to its replay
 * (#1168).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { HashRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StatPlayer, StatRecord } from "../bindings";

function game(
  n: number,
  meWon: boolean,
  durationSec: number,
  mySide: string,
  foeSide: string,
): StatRecord {
  const players: StatPlayer[] = [
    { name: "me", spectator: false, allyTeam: 0, side: mySide, won: meWon },
    { name: "foe", spectator: false, allyTeam: 1, side: foeSide, won: !meWon },
  ];
  return {
    filename: `g${n}.sdfz`,
    path: `/demos/g${n}.sdfz`,
    mapName: "Comet",
    gameType: "BAR",
    engineVersion: "105",
    durationSec,
    startTimeMs: n * 1000,
    sizeBytes: 1,
    modifiedMs: 1,
    winnersKnown: true,
    winningAllyTeams: [meWon ? 0 : 1],
    remixed: false,
    ais: [],
    statsKnown: false,
    teamTotals: [],
    ingestedAt: 0,
    players,
  };
}

const RECORDS = [
  game(1, true, 600, "Armada", "Cortex"),
  game(2, false, 600, "Armada", "Cortex"),
  game(3, true, 4000, "Cortex", "Armada"),
];

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (_key: string, fallback: unknown) => [fallback, () => {}],
}));
vi.mock("../config", () => ({
  useContentState: () => ({ state: { roots: [] } }),
  useReplayStats: () => ({ records: RECORDS, ingesting: false, error: null }),
  useScanTargetSelection: () => ({ selected: null }),
}));
vi.mock("../replayUserState", () => ({
  useReplayUserState: () => ({ state: null }),
  refightFilenames: () => new Set(),
}));

const { default: MatchupPage } = await import("./MatchupPage");

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("MatchupPage", () => {
  it("shows counts, no percentage, and links each game to its replay", () => {
    window.location.hash = "#/stats/foe/matchup?me=me";
    const { container } = render(
      <HashRouter>
        <Routes>
          <Route path="/stats/:name/matchup" element={<MatchupPage />} />
        </Routes>
      </HashRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "me vs foe",
    );
    expect(container.textContent).toContain("3 games against foe: 2 of 3 won");
    expect(container.textContent).not.toContain("%");
    expect(container.textContent).toContain("Armada vs Cortex");
    expect(container.textContent).toContain("1 to 2 hours");
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("#/play/replays/g3.sdfz");
  });
});
