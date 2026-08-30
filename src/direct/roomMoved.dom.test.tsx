// @vitest-environment happy-dom

/**
 * What a host in their battle room is told when the room they are running moves
 * onto a different address (issue #2122).
 *
 * `roomMovedNotice` is tested on its own and proves the words. What it cannot
 * prove is that a move ever reaches this strip: the room moves by itself
 * (issue #2116), the poll in `hostedRoom` is what notices, and the previous
 * address it holds is what turns a reading into a move. So the move is driven
 * here the way a real one arrives, off a reading of `direct_room_status` on the
 * clock, rather than off a deliberate write that would prove the strip and none
 * of the machinery behind it.
 *
 * The strip reads the shared room source itself, which is why nothing is handed
 * to it here.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectRoomStatus } from "./bindings";
import { readHostedRoom, setHostedRoom } from "./hostedRoom";
import { RoomMovedPanel } from "./RoomMoved";

const status = vi.hoisted(() => vi.fn());

vi.mock("./bindings", () => ({
  directRoomStatus: () => status(),
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

/** A room already running at `ip`, with the battle room on screen. */
async function hosting(ip: string) {
  status.mockResolvedValue({ room: running(ip) });
  await act(async () => {
    await readHostedRoom();
  });
  render(<RoomMovedPanel />);
}

/** One tick of the poll, with the room answering from somewhere else. */
async function movesTo(ip: string) {
  status.mockResolvedValue({ room: running(ip) });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
}

describe("a room that moves under a host in their battle room", () => {
  // The failure this exists for. The host starts a room, walks into the battle
  // room and stays there, and everything coilbox says about the room is on the
  // page they left.
  it("names both addresses without the host leaving the battle room", async () => {
    await hosting("192.168.1.45");
    await movesTo("10.8.0.2");

    expect(
      screen.getByText(
        "Your room has moved onto a different address. It was handing out 192.168.1.45 earlier and now hands joiners 10.8.0.2 for the game itself.",
      ),
    ).toBeTruthy();
  });

  // A move arrives while the host is reading the roster or picking a map, so it
  // has to be heard rather than only appear.
  it("says the move out loud", async () => {
    await hosting("192.168.1.45");
    await movesTo("10.8.0.2");

    expect(screen.getByRole("status").textContent).toContain(
      "It was handing out 192.168.1.45 earlier",
    );
  });

  // The move is held for as long as the room runs, which is what makes a
  // notification unnecessary: a host who walked off to Content and came back
  // finds it waiting rather than having missed it.
  it("is still there after the host leaves the battle room and returns", async () => {
    await hosting("192.168.1.45");
    await movesTo("10.8.0.2");
    cleanup();

    render(<RoomMovedPanel />);
    expect(screen.getByRole("status").textContent).toContain(
      "now hands joiners 10.8.0.2 for the game itself",
    );
  });

  // Every reading republishes the room, and the ordinary battle room must stay
  // untouched, so an unchanged address draws nothing at all. Then it moves for
  // real, so the silence is a strip with nothing to say rather than one that
  // never says anything.
  it("stays quiet through a poll that changed nothing, then speaks", async () => {
    await hosting("192.168.1.45");
    await movesTo("192.168.1.45");
    // The element and not only its words. A strip that drew itself with an
    // empty sentence in it would be a bordered box and an icon on every battle
    // anybody hosts, and it has no text for a text assertion to catch.
    expect(screen.queryByRole("status")).toBe(null);
    expect(document.body.textContent).toBe("");

    await movesTo("10.8.0.2");
    expect(screen.getByRole("status").textContent).toContain(
      "now hands joiners 10.8.0.2 for the game itself",
    );
  });
});
