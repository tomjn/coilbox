// @vitest-environment happy-dom

/**
 * The one-battle rule on a battle row (issue #2844). Joining a battle on one
 * server while in a battle on another asks first, and only the confirming
 * button joins. The rule itself is in `oneBattle.ts`, and this is the asking.
 *
 * The popover is stood in for so its contents are always drawn, as in the
 * battle room's close confirmation tests.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Battle } from "../bindings";
import { BattleRow } from "./BattleRow";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("./BattleRowMapThumb", () => ({ BattleRowMapThumb: () => null }));

const NOTICE = "You are in a battle on BAR. Joining this one leaves it.";

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

function drawRow(b: Battle, leaves: string | null) {
  const onJoin = vi.fn();
  render(
    <ul>
      <BattleRow
        battle={b}
        joined={false}
        canJoin={true}
        onJoin={onJoin}
        onLeave={() => {}}
        leaves={leaves}
      />
    </ul>,
  );
  return onJoin;
}

afterEach(cleanup);

describe("joining while in a battle on another server", () => {
  it("joins straight away when it leaves nothing", () => {
    const onJoin = drawRow(battle(), null);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("asks first, and joins only once the player agrees", () => {
    const onJoin = drawRow(battle(), NOTICE);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(onJoin).not.toHaveBeenCalled();
    expect(screen.getByText(NOTICE)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Leave and join" }));
    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it("asks a passworded battle's joiner in the password form", () => {
    const onJoin = drawRow(battle({ passworded: true }), NOTICE);
    expect(screen.getByText(NOTICE)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Battle password"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Leave and join" }));
    expect(onJoin).toHaveBeenCalledWith(expect.anything(), "secret");
  });
});
