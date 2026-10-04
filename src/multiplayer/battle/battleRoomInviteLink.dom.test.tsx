// @vitest-environment happy-dom

/**
 * The invite link button in the battle room header, for a lobby server saved
 * under an IPv6 address (issue #3407). A bare host gets a link, and a host with
 * a zone id gets a disabled button that says why instead of no button at all.
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

const battle = { id: 7, title: "A battle", members: {}, bots: {} } as Battle;

function drawHeader(serverKey: string) {
  render(
    <BattleRoomHeader
      battle={battle}
      myStatus={undefined}
      sync="synced"
      blockShort={null}
      blockReason={null}
      unsynced={[]}
      action="start"
      allReady={true}
      onToggleReady={() => {}}
      onToggleSpectate={() => {}}
      onLeave={() => {}}
      onStart={() => {}}
      onJoinMatch={() => {}}
      selfHost={false}
      canStartDirectly={false}
      closesRoom={false}
      locked={false}
      onToggleLock={() => {}}
      serverKey={serverKey}
      directRoom={false}
    />,
  );
}

afterEach(cleanup);

describe("the invite link button", () => {
  it("is offered for a server saved under a bare IPv6 address", () => {
    drawHeader("me@2001:db8::1:8200");
    expect(
      screen.getByRole("button", {
        name: "Copy an invite link for this battle",
      }),
    ).toBeTruthy();
  });

  it("is disabled, with a reason, for a server saved with a zone id", () => {
    drawHeader("me@fe80::1%eth0:8200");
    expect(
      screen.queryByRole("button", {
        name: "Copy an invite link for this battle",
      }),
    ).toBeNull();
    const button = screen.getByRole("button", {
      name: /^No invite link for this battle\. .*network card/,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.parentElement?.getAttribute("title")).toMatch(/network card/);
  });

  it("shows nothing extra for an ordinary server", () => {
    drawHeader("me@lobby.example.com:8200");
    expect(
      screen.getByRole("button", {
        name: "Copy an invite link for this battle",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^No invite link/ }),
    ).toBeNull();
  });
});
