// @vitest-environment happy-dom

/**
 * A running battle's row says how long the match has been going.
 *
 * That is the fact that decides whether a running room is worth walking into:
 * a match two minutes in can still be watched, and one forty minutes in is a
 * room to wait in for the next game.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Battle } from "../bindings";
import { BattleRow } from "./BattleRow";

vi.mock("./BattleRowMapThumb", () => ({ BattleRowMapThumb: () => null }));

const NOW = 1_791_028_800_000;

function battle(runningSince: number | null): Battle {
  return {
    id: 4,
    host: "Host",
    title: "Running game",
    map: "Map",
    modname: "Game",
    maxPlayers: 8,
    spectatorCount: 0,
    passworded: false,
    locked: false,
    members: {},
    bots: {},
    playerCount: 1,
    runningSince,
  } as unknown as Battle;
}

function drawRow(b: Battle, inProgress: boolean) {
  render(
    <ul>
      <BattleRow
        battle={b}
        joined={false}
        canJoin={true}
        inProgress={inProgress}
        onJoin={() => {}}
        onLeave={() => {}}
      />
    </ul>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a running battle's row", () => {
  it("says how long ago the match started", () => {
    drawRow(battle(NOW - 12 * 60_000), true);
    expect(screen.getByText("Started 12m ago")).toBeTruthy();
  });

  // The row already sits under an "In progress" heading, so with no start time
  // there is nothing more to say.
  it("says nothing more when the start is unknown", () => {
    drawRow(battle(null), true);
    expect(screen.queryByText(/Started|In progress/)).toBeNull();
  });

  it("gets into the room with Join, the same as any other row", () => {
    drawRow(battle(NOW - 12 * 60_000), true);
    expect(screen.getByRole("button", { name: "Join" })).toBeTruthy();
  });
});
