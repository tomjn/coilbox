// @vitest-environment happy-dom
/**
 * Issue #1180: the stats page can be scoped to a set of replays. Members that
 * are not in the library are counted and kept, and a saved scope whose set was
 * deleted means every replay again.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatPlayer, StatRecord } from "../bindings";

function game(n: number, gameId?: string): StatRecord {
  const players: StatPlayer[] = [
    { name: "me", spectator: false, allyTeam: 0, side: "Armada", won: true },
    { name: "foe", spectator: false, allyTeam: 1, side: "Cortex", won: false },
  ];
  return {
    filename: `g${n}.sdfz`,
    path: `/demos/g${n}.sdfz`,
    gameId,
    mapName: "Comet",
    gameType: "BAR",
    engineVersion: "105",
    durationSec: 600,
    startTimeMs: n * 1000,
    sizeBytes: 1,
    modifiedMs: 1,
    winnersKnown: true,
    winningAllyTeams: [0],
    remixed: false,
    ais: [],
    statsKnown: false,
    teamTotals: [],
    ingestedAt: 0,
    players,
  };
}

const RECORDS = [game(1, "id1"), game(2, "id2"), game(3, "id3")];

vi.mock("../config", () => ({
  useContentState: () => ({ state: { roots: [] } }),
  useReplayStats: () => ({
    records: RECORDS,
    summary: null,
    ingesting: false,
    error: null,
  }),
  useScanTargetSelection: () => ({ selected: null }),
}));
vi.mock("./components/AiRecordSection", () => ({
  AiRecordSection: () => null,
}));
vi.mock("./components/AchievementsSection", () => ({
  AchievementsSection: () => null,
}));

const { PersistentStoreProvider } = await import("@picoframe/frame");
const { memorySettingsStorage } = await import("@/lib/storedSetting");
const { default: StatsPage } = await import("./StatsPage");

let storage = memorySettingsStorage();

const gamesCard = (container: HTMLElement) =>
  [...container.querySelectorAll("div")].find((e) => e.textContent === "Games")
    ?.nextElementSibling?.textContent;

function renderPage() {
  return render(
    <PersistentStoreProvider storage={storage}>
      <StatsPage />
    </PersistentStoreProvider>,
  );
}

beforeEach(() => {
  storage = memorySettingsStorage();
  storage.set(
    "content.replaySets",
    JSON.stringify([
      {
        id: "s1",
        name: "Finals",
        members: [
          { filename: "g1.sdfz" },
          { filename: "renamed.sdfz", gameId: "id3" },
          { filename: "gone.sdfz" },
        ],
      },
    ]),
  );
});
afterEach(cleanup);

describe("the stats page scoped to a set", () => {
  it("counts only the set's replays and reports the missing one", () => {
    storage.set("content.statsSet", JSON.stringify("s1"));
    const { container } = renderPage();
    expect(gamesCard(container)).toBe("2");
    expect(container.textContent).toContain(
      "2 of 3 in your library, 1 missing",
    );
  });

  it("counts every replay with no scope", () => {
    const { container } = renderPage();
    expect(gamesCard(container)).toBe("3");
    expect(screen.queryByText(/in your library/)).toBeNull();
  });

  it("counts every replay when the saved set was deleted", () => {
    storage.set("content.statsSet", JSON.stringify("deleted"));
    const { container } = renderPage();
    expect(gamesCard(container)).toBe("3");
  });
});
