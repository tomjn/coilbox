/**
 * Taking a hosted room down (issue #2057).
 *
 * There are two buttons that end a room: "Stop room" on the Battles page and
 * "Close battle" in the battle room the host is sitting in. They ran different
 * code, and the second one only left the battle, so the room carried on
 * listening and carried on being announced. One function now, and these are the
 * things that function has to do in the order it has to do them in.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every call this makes, in the order it made them. */
let calls: string[] = [];
let stopFails = false;

vi.mock("./bindings", () => ({
  directStopRoom: async ({ reason }: { reason?: string | null }) => {
    calls.push(`stop:${reason ?? ""}`);
    if (stopFails) throw new Error("the room would not stop");
    return { stopped: true };
  },
}));

vi.mock("./reachability", () => ({
  directClosePorts: async () => {
    calls.push("closePorts");
    return { closed: true };
  },
}));

vi.mock("./hostedRoom", () => ({
  setHostedRoom: (room: unknown) => {
    calls.push(`publish:${room === null ? "none" : "room"}`);
  },
  readHostedRoom: async () => {
    calls.push("reread");
    return null;
  },
}));

const { stopHostedRoom } = await import("./stopRoom");

/** A disconnect that records itself, standing in for the store's. */
async function disconnect() {
  calls.push("disconnect");
}

beforeEach(() => {
  calls = [];
  stopFails = false;
});

describe("stopping the room this client hosts", () => {
  // Our own client goes first on purpose: a client dropped by a port that is
  // about to close reads as a server that fell over, and starts reconnecting to
  // it.
  it("drops this client before it closes the room under it", async () => {
    await stopHostedRoom("alice", disconnect);
    expect(calls.indexOf("disconnect")).toBeLessThan(
      calls.findIndex((c) => c.startsWith("stop:")),
    );
  });

  // The joiners hear words rather than a socket that stopped answering.
  it("tells the room who closed it, so its joiners are told", async () => {
    await stopHostedRoom("alice", disconnect);
    expect(calls).toContain("stop:alice closed this room");
  });

  // The bug in full: the room ends, and everything the room asked the network
  // for ends with it. A close that left the mapping behind would leave a port
  // open on somebody's router for the rest of its lease.
  it("hands back the ports the room asked for", async () => {
    await stopHostedRoom("alice", disconnect);
    expect(calls).toContain("closePorts");
  });

  // Nothing polls fast enough to beat a host walking back to the Battles page,
  // so the answer is said rather than waited for.
  it("says there is no room now without waiting to be asked", async () => {
    await stopHostedRoom("alice", disconnect);
    expect(calls).toContain("publish:none");
  });

  // A room that would not stop is still up, and saying it has gone would leave
  // the host with no button to press. The caller is told so it can say why.
  it("leaves a room that would not stop standing, and re-reads it", async () => {
    stopFails = true;
    await expect(stopHostedRoom("alice", disconnect)).rejects.toThrow(
      "the room would not stop",
    );
    expect(calls).toContain("reread");
    expect(calls).not.toContain("publish:none");
  });
});
