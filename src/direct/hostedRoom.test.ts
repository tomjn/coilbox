import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectRoomStatus } from "./bindings";

const status = vi.fn();
vi.mock("./bindings", () => ({
  directRoomStatus: (args: Record<string, never>) => status(args),
}));

const running = (pending: string[] = []): DirectRoomStatus => ({
  port: 8200,
  host: "alice",
  ip: "192.168.0.5",
  approveJoins: true,
  advertise: true,
  peers: 2,
  pending,
  battle: null,
});

/** A fresh copy of the module, because its state is a module singleton. */
async function load() {
  vi.resetModules();
  return await import("./hostedRoom");
}

beforeEach(() => {
  vi.useFakeTimers();
  status.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the shared reading of a hosted room", () => {
  it("does not run a clock for a client that hosts nothing", async () => {
    const { readHostedRoom } = await load();
    status.mockResolvedValue({ room: null });

    expect(await readHostedRoom()).toBeNull();
    expect(status).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(status).toHaveBeenCalledTimes(1);
  });

  // The whole point of one source: it keeps reading wherever the host has
  // wandered off to, so somebody waiting at the door reaches them (issue #1600).
  it("keeps reading while there is a room, with no page mounted", async () => {
    const { readHostedRoom, subscribeHostedRoom } = await load();
    status.mockResolvedValue({ room: running() });
    const seen: (DirectRoomStatus | null)[] = [];
    subscribeHostedRoom((room) => seen.push(room));

    await readHostedRoom();
    status.mockResolvedValue({ room: running(["bob"]) });
    await vi.advanceTimersByTimeAsync(2000);

    expect(seen.at(-1)?.pending).toEqual(["bob"]);
  });

  it("stops the clock once the room has gone", async () => {
    const { readHostedRoom } = await load();
    status.mockResolvedValue({ room: running() });
    await readHostedRoom();

    status.mockResolvedValue({ room: null });
    await vi.advanceTimersByTimeAsync(2000);
    const calls = status.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(status).toHaveBeenCalledTimes(calls);
  });

  // A stop is deliberate. A reading that was already in flight describes the
  // room as it was a moment ago, and letting it land would put the line back.
  it("drops a reading that a deliberate write has overtaken", async () => {
    const { readHostedRoom, setHostedRoom, subscribeHostedRoom } = await load();
    let answer: (value: { room: DirectRoomStatus | null }) => void = () => {};
    status.mockReturnValue(
      new Promise<{ room: DirectRoomStatus | null }>((resolve) => {
        answer = resolve;
      }),
    );

    const inFlight = readHostedRoom();
    setHostedRoom(null);
    const seen: (DirectRoomStatus | null)[] = [];
    subscribeHostedRoom((room) => seen.push(room));
    answer({ room: running() });
    await inFlight;

    expect(seen).toEqual([]);
  });

  it("keeps the last reading when the room cannot be asked", async () => {
    const { readHostedRoom } = await load();
    status.mockResolvedValue({ room: running(["bob"]) });
    await readHostedRoom();

    status.mockRejectedValue(new Error("the window is closing"));
    expect((await readHostedRoom())?.pending).toEqual(["bob"]);
  });

  // The failure this module was built with (issue #2124). The first reading of
  // all is asked for once, from a mount effect, and it is the reading that
  // starts the clock. So a first reading that failed had nothing coming after it
  // to try again, and a host running a room went undescribed everywhere for the
  // rest of the session.
  it("asks again when the first reading fails", async () => {
    const { readHostedRoom, subscribeHostedRoom } = await load();
    const seen: (DirectRoomStatus | null)[] = [];
    subscribeHostedRoom((room) => seen.push(room));
    status.mockRejectedValue(new Error("the plugin is not ready"));

    await readHostedRoom();
    status.mockResolvedValue({ room: running() });
    await vi.advanceTimersByTimeAsync(2000);

    expect(seen.at(-1)?.host).toBe("alice");
  });

  // Asking again is the fix, asking forever is not. A client that is simply not
  // hosting must end up back where it started, with no clock.
  it("stops asking once a reading says there is no room", async () => {
    const { readHostedRoom } = await load();
    status.mockRejectedValue(new Error("the plugin is not ready"));
    await readHostedRoom();

    status.mockResolvedValue({ room: null });
    await vi.advanceTimersByTimeAsync(2000);
    expect(status).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(status).toHaveBeenCalledTimes(2);
  });

  // A stop is deliberate, and a failed reading it overtook says nothing about
  // the room. Retrying it would put a clock back on a room the host has ended.
  it("does not ask again after a failure a deliberate stop has overtaken", async () => {
    const { readHostedRoom, setHostedRoom } = await load();
    let refuse: (reason: Error) => void = () => {};
    status.mockReturnValue(
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
    );

    const inFlight = readHostedRoom();
    setHostedRoom(null);
    refuse(new Error("the window is closing"));
    await inFlight;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(status).toHaveBeenCalledTimes(1);
  });
});
