// @vitest-environment happy-dom

/**
 * Battles are cards in a shared grid (issue #4193). A long title or map name
 * is cut off with an ellipsis, so the full text has to be on hover.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Battle } from "../bindings";
import { BATTLE_GRID, BattleRow } from "./BattleRow";

vi.mock("./BattleRowMapThumb", () => ({ BattleRowMapThumb: () => null }));

const battle = {
  id: 4,
  host: "Host",
  title: "A very long battle title that will not fit on a narrow card",
  map: "Some Long Map Name v2",
  modname: "Game",
  maxPlayers: 8,
  spectatorCount: 0,
  passworded: false,
  locked: false,
  members: {},
  bots: {},
  playerCount: 1,
} as unknown as Battle;

afterEach(cleanup);

describe("battle card", () => {
  it("shows the full title and the map, game and host on hover", () => {
    render(
      <ul>
        <BattleRow
          battle={battle}
          joined={false}
          canJoin={true}
          onJoin={vi.fn()}
          onLeave={() => {}}
        />
      </ul>,
    );
    expect(screen.getByTitle(battle.title)).toBeTruthy();
    expect(
      screen.getByTitle("Some Long Map Name v2 · Game · host Host"),
    ).toBeTruthy();
  });

  it("grid sizes columns from a minimum card width, not breakpoints", () => {
    expect(BATTLE_GRID).toContain("auto-fill");
    expect(BATTLE_GRID).toContain("minmax(");
  });
});
