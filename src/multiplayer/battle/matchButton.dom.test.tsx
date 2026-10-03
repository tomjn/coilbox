// @vitest-environment happy-dom

/**
 * The battle room's main button once a match is running.
 *
 * The button used to seize up as a disabled "In game" the moment the host
 * launched, and the only way into the match was a banner that showed in one
 * state out of several. Now the button is the way in, and it says which way:
 * back to your slot, or in to watch. It also says how long the match has been
 * going, because that is what decides whether watching is worth the wait.
 *
 * Radix's popover is stood in for so the confirmation is on screen without a
 * click, the same as the close-battle tests beside this file.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Battle } from "../bindings";
import { BattleRoomHeader } from "./BattleRoomHeader";
import type { MatchAction } from "./matchAction";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

const NOW = 1_791_028_800_000;
const MINUTE = 60_000;

function battle(runningSince: number | null): Battle {
  return {
    id: 7,
    tachyonId: null,
    host: "host",
    ip: "",
    port: "",
    natType: "0",
    relayed: false,
    map: "Comet Catcher Remake 1.8",
    maphash: "",
    modname: "Beyond All Reason test-1234",
    engine: "",
    version: "",
    maxPlayers: 8,
    playerCount: null,
    passworded: false,
    locked: false,
    spectatorCount: 0,
    title: "A battle",
    channel: null,
    members: {},
    bots: {},
    scriptTags: {},
    startRects: {},
    bosses: [],
    bossesEnabled: false,
    inProgress: false,
    runningSince,
    mode: null,
  };
}

function drawHeader(over: {
  action: MatchAction;
  runningSince?: number | null;
  blockReason?: string | null;
}) {
  const onJoinMatch = vi.fn();
  const onStart = vi.fn();
  render(
    <BattleRoomHeader
      battle={battle(over.runningSince ?? null)}
      myStatus={undefined}
      sync="synced"
      blockShort={null}
      blockReason={over.blockReason ?? null}
      unsynced={[]}
      action={over.action}
      allReady={true}
      onToggleReady={() => {}}
      onToggleSpectate={() => {}}
      onLeave={() => {}}
      onStart={onStart}
      onJoinMatch={onJoinMatch}
      selfHost={false}
      canStartDirectly={false}
      closesRoom={false}
      locked={false}
      onToggleLock={() => {}}
      serverKey={null}
      directRoom={false}
    />,
  );
  return { onJoinMatch, onStart };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the main button once a match is running", () => {
  it("brings a participant back in with one click, however late", () => {
    const { onJoinMatch } = drawHeader({
      action: "rejoin",
      runningSince: NOW - 40 * MINUTE,
    });
    fireEvent.click(screen.getByRole("button", { name: "Rejoin" }));
    expect(onJoinMatch).toHaveBeenCalledTimes(1);
    // A participant is not asked whether the wait is worth it. It is their game.
    expect(screen.queryByRole("button", { name: "Watch anyway" })).toBeNull();
  });

  it("lets a match that has just started be watched with one click", () => {
    const { onJoinMatch } = drawHeader({
      action: "watch",
      runningSince: NOW - 2 * MINUTE,
    });
    fireEvent.click(screen.getByRole("button", { name: "Watch" }));
    expect(onJoinMatch).toHaveBeenCalledTimes(1);
  });

  it("asks before watching a match that is well under way", () => {
    const { onJoinMatch } = drawHeader({
      action: "watch",
      runningSince: NOW - 12 * MINUTE,
    });
    fireEvent.click(screen.getByRole("button", { name: "Watch" }));
    expect(onJoinMatch).not.toHaveBeenCalled();
    expect(screen.getByText(/This match started 12m ago\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Watch anyway" }));
    expect(onJoinMatch).toHaveBeenCalledTimes(1);
  });

  it("asks before watching a match nobody can put a start time on", () => {
    const { onJoinMatch } = drawHeader({ action: "watch", runningSince: null });
    fireEvent.click(screen.getByRole("button", { name: "Watch" }));
    expect(onJoinMatch).not.toHaveBeenCalled();
    expect(screen.getByText(/already running when you connected/)).toBeTruthy();
  });

  it("offers no way in to somebody who cannot run the match", () => {
    drawHeader({
      action: "watch",
      runningSince: NOW - 2 * MINUTE,
      blockReason: "You do not have the map.",
    });
    const button = screen.getByRole("button", { name: "Watch" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("You do not have the map.");
  });

  it("says nothing can be done while our own engine is in the match", () => {
    drawHeader({ action: "ingame", runningSince: NOW - 12 * MINUTE });
    const button = screen.getByRole("button", { name: "In game" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("how long the match has been going", () => {
  it.each<MatchAction>([
    "rejoin",
    "watch",
    "ingame",
  ])("is said beside the button when it reads %s", (action) => {
    drawHeader({ action, runningSince: NOW - 12 * MINUTE });
    expect(screen.getByText("Started 12m ago")).toBeTruthy();
  });

  it("is said without a number when the start is unknown", () => {
    drawHeader({ action: "ingame", runningSince: null });
    expect(screen.getByText("In progress")).toBeTruthy();
  });

  it("is not said before a match has started", () => {
    drawHeader({ action: "start", runningSince: null });
    expect(screen.queryByText("In progress")).toBeNull();
    expect(screen.getByRole("button", { name: "Vote to start" })).toBeTruthy();
  });
});
