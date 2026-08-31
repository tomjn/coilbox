// @vitest-environment happy-dom

/**
 * What "Close battle" promises before it is pressed (issue #2057).
 *
 * The button used to say a self-hosted LAN battle would disappear and then
 * leave the room running, still holding its port and still announcing itself.
 * The doing half is `closeEndsTheRoom` and `stopHostedRoom`, both tested on
 * their own. This is the saying half: a host reads the confirmation and decides
 * whether to press it, so the two sentences have to describe the two different
 * things that happen.
 *
 * Radix's popover is stood in for so the confirmation is on screen without a
 * click, the same as the route-word tests beside this file.
 */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Battle } from "../bindings";
import { BattleRoomHeader } from "./BattleRoomHeader";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

function battle(): Battle {
  return {
    id: 7,
    tachyonId: null,
    host: "me",
    ip: "",
    port: "",
    natType: "0",
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
    mode: null,
  };
}

function drawHeader(over: { closesRoom?: boolean } = {}) {
  render(
    <BattleRoomHeader
      battle={battle()}
      myStatus={undefined}
      sync="synced"
      blockShort={null}
      blockReason={null}
      unsynced={[]}
      hostIngame={false}
      allReady={false}
      onToggleReady={() => {}}
      onToggleSpectate={() => {}}
      onLeave={() => {}}
      onStart={() => {}}
      selfHost={true}
      closesRoom={over.closesRoom ?? false}
      locked={false}
      onToggleLock={() => {}}
      serverKey={null}
      directRoom={over.closesRoom ?? false}
    />,
  );
}

afterEach(cleanup);

describe("the close confirmation", () => {
  // The room is the part a host would not think to go back for, and the part
  // that keeps a port bound and keeps advertising on the network.
  it("tells a LAN host that the room goes with the battle", () => {
    drawHeader({ closesRoom: true });
    expect(
      screen.getByText(
        "Close this battle? Everyone will be removed, and the room it is in will stop hosting and give its port back.",
      ),
    ).toBeTruthy();
  });

  // A battle founded on a lobby server. There is no room of ours behind it, so
  // promising one would stop is inventing something.
  it("promises a battle on a server nothing about a room", () => {
    drawHeader({ closesRoom: false });
    expect(
      screen.getByText(
        "Close this battle? Everyone will be removed and it will disappear from the battle list.",
      ),
    ).toBeTruthy();
  });
});
