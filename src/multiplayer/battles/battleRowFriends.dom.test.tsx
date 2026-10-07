// @vitest-environment happy-dom

/**
 * A battle with a friend in it says so on its row, in words and an icon rather
 * than colour alone, so a player scanning the list can find where their friends
 * are. The badge counts them and its tooltip names them.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Battle } from "../bindings";
import { BattleRow } from "./BattleRow";

vi.mock("./BattleRowMapThumb", () => ({ BattleRowMapThumb: () => null }));

const battle = {
  id: 4,
  host: "Host",
  title: "Skirmish",
  map: "Map",
  modname: "Game",
  maxPlayers: 8,
  spectatorCount: 0,
  passworded: false,
  locked: false,
  members: {},
  bots: {},
  playerCount: 1,
  runningSince: null,
} as unknown as Battle;

function drawRow(friendsHere?: string) {
  render(
    <ul>
      <BattleRow
        battle={battle}
        joined={false}
        canJoin={true}
        friendsHere={friendsHere}
        onJoin={() => {}}
        onLeave={() => {}}
      />
    </ul>,
  );
}

afterEach(cleanup);

describe("a battle row with friends in it", () => {
  it("counts the friends who are in it", () => {
    drawRow("amy, bob");
    expect(screen.getByText("2 friends in battle")).toBeTruthy();
  });

  it("does not count a lone friend", () => {
    drawRow("amy");
    expect(screen.getByText("Friend in battle")).toBeTruthy();
  });

  it("names the friends when the badge takes focus", async () => {
    drawRow("amy, bob");
    fireEvent.focus(screen.getByRole("button", { name: /friends in battle/ }));
    expect((await screen.findAllByText("amy, bob")).length).toBeGreaterThan(0);
  });

  it("says nothing when no friend is in it", () => {
    drawRow(undefined);
    expect(screen.queryByText(/in battle/)).toBeNull();
  });
});
