// @vitest-environment happy-dom

/**
 * What a host reads about the address their running room hands out (issue #2118).
 *
 * `gameAddressNote` is tested on its own and proves the words are right. What it
 * cannot prove is that anybody ever sees them, or that a room moving under the
 * host reaches the screen: that is the poll in `hostedRoom`, the previous
 * address it holds, and the line in `HostRoomControl`, and none of the three is
 * any use without the other two. The room in issue #2116 moves on its own, so
 * the move is driven here the way a real one arrives, off a reading of
 * `direct_room_status` on the clock rather than off a deliberate write.
 *
 * The host is wired up the way `BattlesPage` wires it, reading the room off the
 * shared source and handing it down, because that is the arrangement the address
 * has to survive.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectRoomStatus } from "./bindings";
import { HostRoomControl } from "./HostRoomControl";
import { readHostedRoom, setHostedRoom, useHostedRoom } from "./hostedRoom";

const status = vi.hoisted(() => vi.fn());

vi.mock("./bindings", () => ({
  directRoomStatus: () => status(),
  // This machine's own addresses are the list above the line under test, and
  // there is no machine here to enumerate. Refusing leaves that list undrawn,
  // which is what it does on a real machine that has not answered yet.
  directLocalAddresses: () => Promise.reject(new Error("no machine here")),
}));

const running = (ip: string): DirectRoomStatus => ({
  port: 8200,
  host: "alice",
  ip,
  approveJoins: false,
  advertise: true,
  peers: 2,
  pending: [],
  battle: null,
});

/** The Battles page's own wiring, with everything the address does not depend on
 *  held still. */
function Host() {
  const room = useHostedRoom();
  return (
    <HostRoomControl
      room={room}
      heardOnNetwork={true}
      blocked={null}
      busy={false}
      error={null}
      onStart={async () => {}}
      onStop={() => {}}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  status.mockReset();
});

afterEach(() => {
  cleanup();
  // Ends the room, which stops the clock and forgets the move, so the next test
  // starts on a client that is hosting nothing.
  setHostedRoom(null);
  vi.useRealTimers();
});

/** A room already running at `ip`, on screen. */
async function hosting(ip: string) {
  status.mockResolvedValue({ room: running(ip) });
  await act(async () => {
    await readHostedRoom();
  });
  render(<Host />);
}

/** One tick of the poll, with the room answering from somewhere else. */
async function movesTo(ip: string) {
  status.mockResolvedValue({ room: running(ip) });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
}

describe("the address a running room hands out", () => {
  it("is on screen while the room runs", async () => {
    await hosting("192.168.1.45");

    expect(
      screen.getByText(
        "The room hands joiners 192.168.1.45 for the game itself.",
      ),
    ).toBeTruthy();
  });

  // The failure this exists for. A VPN comes up, the room follows the machine
  // onto its address, and everybody who launches from here dials a network the
  // people in the room are not on.
  it("names the address it left when the room moves under the host", async () => {
    await hosting("192.168.1.45");
    await movesTo("10.8.0.2");

    expect(
      screen.getByText(
        "The room hands joiners 10.8.0.2 for the game itself. It was handing out 192.168.1.45 earlier.",
      ),
    ).toBeTruthy();
  });

  // A move is worth hearing rather than only seeing, because the host who needs
  // it is reading the line for another reason.
  it("says a move out loud", async () => {
    await hosting("192.168.1.45");
    await movesTo("10.8.0.2");

    expect(screen.getByRole("status").textContent).toContain(
      "It was handing out 192.168.1.45 earlier.",
    );
  });

  // Every reading republishes the room, so an unchanged address must not read as
  // a move.
  it("says nothing about a move while the room has not moved", async () => {
    await hosting("192.168.1.45");
    await movesTo("192.168.1.45");

    expect(
      screen.getByText(
        "The room hands joiners 192.168.1.45 for the game itself.",
      ),
    ).toBeTruthy();
  });
});
