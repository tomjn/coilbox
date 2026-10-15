// @vitest-environment happy-dom

/**
 * Where the Share button sits in the battle room's header, and that the band of
 * join addresses it replaced is gone (issue #3460).
 *
 * The page hands the header a room only for the battle inside this client's own
 * room (`closeEndsTheRoom`), so this is the header's half of that: a room given
 * draws the button, none draws nothing.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectRoomStatus } from "@/direct/bindings";
import type { Battle } from "../bindings";
import { BattleRoomHeader } from "./BattleRoomHeader";

vi.mock("@/direct/bindings", () => ({
  directLocalAddresses: () =>
    Promise.resolve({
      addresses: [
        { address: "192.168.1.45", interface: "en0", loopback: false },
      ],
    }),
}));

vi.mock("@/direct/reachability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/direct/reachability")>()),
  directPortStatus: () => Promise.resolve({ reachability: null }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const battle = {
  id: 1,
  title: "alice's room",
  locked: false,
  inProgress: false,
  relayed: false,
} as unknown as Battle;

const status: DirectRoomStatus = {
  port: 8200,
  host: "alice",
  ip: "192.168.1.45",
  approveJoins: false,
  advertise: true,
  peers: 1,
  pending: [],
  battle: null,
};

function header(over: {
  selfHost: boolean;
  sharedRoom: DirectRoomStatus | null;
  connectionLabel?: string | null;
}) {
  return (
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
      selfHost={over.selfHost}
      canStartDirectly={true}
      closesRoom={over.sharedRoom !== null}
      locked={false}
      onToggleLock={() => {}}
      serverKey={null}
      directRoom={over.sharedRoom !== null}
      sharedRoom={over.sharedRoom}
      connectionLabel={over.connectionLabel}
    />
  );
}

afterEach(cleanup);

describe("the battle room header", () => {
  it("has a Share button beside Close and Start for the host of a room on this computer", () => {
    render(header({ selfHost: true, sharedRoom: status }));

    const share = screen.getByRole("button", { name: /^Share/ });
    const close = screen.getByRole("button", { name: /^Close/ });
    const start = screen.getByRole("button", { name: /Start/ });
    expect(share.parentElement).toBe(close.parentElement);
    expect(share.parentElement).toBe(start.parentElement);
  });

  it("has no Share button when the battle is not in a room of our own", () => {
    render(header({ selfHost: true, sharedRoom: null }));

    expect(screen.queryByRole("button", { name: /^Share/ })).toBeNull();
  });

  it("has no Share button for somebody who only joined", () => {
    render(header({ selfHost: false, sharedRoom: null }));

    expect(screen.queryByRole("button", { name: /^Share/ })).toBeNull();
  });

  it("names the account and server above the battle's name when it is given one", () => {
    render(
      header({
        selfHost: false,
        sharedRoom: null,
        connectionLabel: "alice on Recoil Official",
      }),
    );

    const label = screen.getByText("alice on Recoil Official");
    const title = screen.getByRole("heading", { level: 1 });
    expect(title.textContent).toBe("alice's room");
    expect(
      label.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("draws no line above the battle's name without one", () => {
    render(header({ selfHost: false, sharedRoom: null }));

    expect(screen.queryByText(/ on /)).toBeNull();
  });

  // The band is not in the header, and nothing renders it any more.
  it("draws no band of addresses under it", () => {
    render(header({ selfHost: true, sharedRoom: status }));

    expect(screen.queryByLabelText("Invite people to this room")).toBeNull();
    expect(screen.queryByText("Copy link")).toBeNull();
    expect(screen.queryByText("192.168.1.45:8200")).toBeNull();
  });
});
