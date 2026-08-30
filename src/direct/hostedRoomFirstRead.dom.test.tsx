// @vitest-environment happy-dom

/**
 * What a host sees when the first reading of their room fails (issue #2124).
 *
 * `hostedRoom` is tested on its own and proves the clock keeps asking. What it
 * cannot prove is that the failure has a consequence anybody sees, or that the
 * one thing which asks for the first reading is a mount effect that never runs
 * twice. Nothing else in the repo mounts `HostedRoomProvider`, so the arrangement
 * that produced the bug, an effect with an empty dependency list feeding a clock
 * that only a successful reading starts, is only assembled here.
 *
 * The host is wired up the way `BattlesPage` wires it, reading the room off the
 * shared source and handing it to `HostRoomControl`, because "Host on LAN" on
 * screen while a room is up is the symptom.
 */

import { DrawerProvider } from "@picoframe/frame";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectRoomStatus } from "./bindings";
import { HostedRoomProvider } from "./HostedRoomProvider";
import { HostRoomControl } from "./HostRoomControl";
import { setHostedRoom, useHostedRoom } from "./hostedRoom";

const status = vi.hoisted(() => vi.fn());

vi.mock("./bindings", () => ({
  directRoomStatus: () => status(),
  // No machine here to enumerate, which leaves the list of addresses undrawn.
  // Not what this is about.
  directLocalAddresses: () => Promise.reject(new Error("no machine here")),
}));

// The provider also watches for people waiting at the door, which reaches the
// OS. Nobody is waiting in any of this, so it is held still rather than driven.
vi.mock("@/notify/notify", () => ({ notify: async () => {} }));

const running = (): DirectRoomStatus => ({
  port: 8200,
  host: "alice",
  ip: "192.168.1.45",
  approveJoins: false,
  advertise: true,
  peers: 1,
  pending: [],
  battle: null,
});

/**
 * The Battles page's own wiring, under the provider that makes the first ask.
 * The drawer provider is there because "Host on LAN" opens the form in a drawer,
 * and in the app the frame supplies it.
 */
function App() {
  return (
    <DrawerProvider>
      <HostedRoomProvider>
        <Host />
      </HostedRoomProvider>
    </DrawerProvider>
  );
}

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
  // Ends the room, which stops the clock, so the next test starts on a client
  // that is hosting nothing.
  setHostedRoom(null);
  vi.useRealTimers();
});

/** The app coming up while the plugin refuses to answer. */
async function startsWhileTheRoomCannotBeRead() {
  status.mockRejectedValue(new Error("the plugin is not ready"));
  await act(async () => {
    render(<App />);
  });
}

/** One tick of the poll, with the room answering this time. */
async function theRoomAnswers() {
  status.mockResolvedValue({ room: running() });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
}

describe("a host whose first reading of their room failed", () => {
  // The symptom. Worth pinning even though the fix does not change it: it is the
  // state the fix has to get out of, and it is a lie about a running room.
  it("is offered a room to host while one is already up", async () => {
    await startsWhileTheRoomCannotBeRead();

    expect(screen.getByRole("button", { name: "Host on LAN" })).toBeTruthy();
  });

  it("is told about their room once a later reading lands", async () => {
    await startsWhileTheRoomCannotBeRead();
    await theRoomAnswers();

    expect(
      screen.getByText("Hosting on port 8200 as alice, nobody has joined yet"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Host on LAN" })).toBeNull();
  });
});
