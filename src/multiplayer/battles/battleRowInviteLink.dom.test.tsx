// @vitest-environment happy-dom

/**
 * The invite link button on a battle row (issue #2372). It used to render
 * enabled regardless of whether the connection could act on anything, so it
 * offered a link to a battle you had just been told you couldn't join.
 *
 * The fix gates it on `linkable` (connection state alone) rather than
 * `canJoin`: a link to a full battle, or to the one you're already in, is
 * still worth sending, so only "not connected" should disable it.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Battle } from "../bindings";
import { BattleRow } from "./BattleRow";

vi.mock("./BattleRowMapThumb", () => ({ BattleRowMapThumb: () => null }));

function battle(over: Partial<Battle> = {}): Battle {
  return {
    id: 4,
    host: "Host",
    title: "Open game",
    map: "Map",
    modname: "Game",
    maxPlayers: 8,
    spectatorCount: 0,
    passworded: false,
    locked: false,
    members: {},
    bots: {},
    playerCount: 1,
    ...over,
  } as unknown as Battle;
}

function inviteButton() {
  return screen.getByRole("button", {
    name: "Copy an invite link for Open game",
  });
}

afterEach(cleanup);

describe("battle row invite link", () => {
  it("stays enabled for a full battle, since canJoin alone would block it", () => {
    render(
      <ul>
        <BattleRow
          battle={battle({ playerCount: 8 })}
          joined={false}
          canJoin={false}
          linkable={true}
          onJoin={vi.fn()}
          onLeave={() => {}}
          serverAddress="example.org:8200"
        />
      </ul>,
    );
    expect(inviteButton()).toHaveProperty("disabled", false);
  });

  it("stays enabled for the battle you're already in", () => {
    render(
      <ul>
        <BattleRow
          battle={battle()}
          joined={true}
          canJoin={false}
          linkable={true}
          onJoin={vi.fn()}
          onLeave={() => {}}
          serverAddress="example.org:8200"
        />
      </ul>,
    );
    expect(inviteButton()).toHaveProperty("disabled", false);
  });

  it("disables when the connection itself isn't ready", () => {
    render(
      <ul>
        <BattleRow
          battle={battle()}
          joined={false}
          canJoin={false}
          linkable={false}
          onJoin={vi.fn()}
          onLeave={() => {}}
          serverAddress="example.org:8200"
        />
      </ul>,
    );
    expect(inviteButton()).toHaveProperty("disabled", true);
  });

  it("defaults to enabled when a caller doesn't track connection state", () => {
    render(
      <ul>
        <BattleRow
          battle={battle()}
          joined={false}
          canJoin={true}
          onJoin={vi.fn()}
          onLeave={() => {}}
          serverAddress="example.org:8200"
        />
      </ul>,
    );
    expect(inviteButton()).toHaveProperty("disabled", false);
  });
});
