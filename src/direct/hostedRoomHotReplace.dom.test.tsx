// @vitest-environment happy-dom

/**
 * What a host sees when the dev server replaces this module under them (issue
 * #2126).
 *
 * Editing anything `hostedRoom` imports makes Vite build a fresh copy of it and
 * hand that to the components. Nothing asks the fresh copy for a first reading,
 * because the one thing that asks is a mount effect with an empty dependency
 * list and a hot update does not re-run it. So the copy used to come up on a
 * null with no clock, the Battles page offered to host a room that was already
 * running, and the copy being replaced went on polling for the rest of the
 * session.
 *
 * `vi.resetModules()` stands in for the hot update: it makes the next import
 * build a second instance of the same file, which is what Vite does. The carrier
 * is mocked because `import.meta.hot` does not exist under the test runner, and
 * it is the same object across both instances because that is the one thing Vite
 * keeps.
 *
 * Development only, so nothing here is about a released build. It is tested
 * because the symptom looks exactly like a broken room and has already sent two
 * issues after the wrong cause.
 *
 * One thing here is not covered. The replacement takes the clock over so that an
 * edit to the poll is the poll that runs, and both copies are the same file
 * under the test runner, so nothing can tell whose callback ticked. `vi.mock`
 * factories are not re-run by `vi.resetModules()`, which rules out marking the
 * copies apart through the bindings. That half was checked by hand against the
 * dev server instead.
 */

import { DrawerProvider } from "@picoframe/frame";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectRoomStatus } from "./bindings";
import { HostRoomControl } from "./HostRoomControl";

const carrier = vi.hoisted(() => ({}) as Record<string, unknown>);
const status = vi.hoisted(() => vi.fn());

vi.mock("./hotCarrier", () => ({ hotCarrier: carrier }));

vi.mock("./bindings", () => ({
  directRoomStatus: () => status(),
  // No machine here to enumerate, which leaves the list of addresses undrawn.
  // Not what this is about.
  directLocalAddresses: () => Promise.reject(new Error("no machine here")),
}));

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

type HostedRoomModule = typeof import("./hostedRoom");

/** A copy of the module, the way an edit gets the components a fresh one. */
async function anotherCopy(): Promise<HostedRoomModule> {
  vi.resetModules();
  return await import("./hostedRoom");
}

/**
 * A copy that has been told there is a room, which is what starting one does and
 * what the mount effect's first reading does on the way up.
 */
async function anotherCopyTold(): Promise<HostedRoomModule> {
  const copy = await anotherCopy();
  copy.setHostedRoom(running());
  return copy;
}

/** The Battles page's own wiring, over whichever copy is being asked. */
function Host({ useRoom }: { useRoom: () => DirectRoomStatus | null }) {
  return (
    <DrawerProvider>
      <HostRoomControl
        room={useRoom()}
        heardOnNetwork={true}
        blocked={null}
        busy={false}
        error={null}
        onStart={async () => {}}
        onStop={() => {}}
      />
    </DrawerProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  status.mockReset();
  status.mockRejectedValue(new Error("not asked in this test"));
});

afterEach(() => {
  cleanup();
  // Both the clock and the room live in the carrier now, so the next test starts
  // on a client that has never hosted anything.
  vi.useRealTimers();
  delete carrier.hostedRoom;
});

describe("a copy of the hosted room made by a hot update", () => {
  it("describes the room the copy before it was holding", async () => {
    await anotherCopyTold();
    const replacement = await anotherCopy();

    await act(async () => {
      render(<Host useRoom={replacement.useHostedRoom} />);
    });

    expect(
      screen.getByText("Hosting on port 8200 as alice, nobody has joined yet"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Host on LAN" })).toBeNull();
  });

  it("asks the room once a tick however many copies it has been", async () => {
    await anotherCopyTold();
    await anotherCopyTold();
    await anotherCopyTold();

    expect(vi.getTimerCount()).toBe(1);

    status.mockResolvedValue({ room: running() });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(status).toHaveBeenCalledTimes(1);
  });

  it("goes on asking when nobody has told it anything", async () => {
    await anotherCopyTold();
    // Nothing tells the replacement anything, which is the whole trouble: the
    // mount effect that makes the first reading does not run again. It takes the
    // clock over anyway, so that an edit to the poll is the poll that runs.
    await anotherCopy();

    expect(vi.getTimerCount()).toBe(1);

    status.mockResolvedValue({ room: running() });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(status).toHaveBeenCalledTimes(1);
  });

  it("still reaches a listener the copy before it took", async () => {
    const first = await anotherCopy();
    const heard: (DirectRoomStatus | null)[] = [];
    // The notification watcher subscribes from the same mount effect that makes
    // the first reading, so a hot update leaves it on the copy that went.
    first.subscribeHostedRoom((room) => heard.push(room));

    const replacement = await anotherCopy();
    replacement.setHostedRoom(running());

    expect(heard).toEqual([running()]);
  });
});
