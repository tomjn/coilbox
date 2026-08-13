import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROOM_PORT,
  directServer,
  isDirectKey,
  normalizeRoomPort,
  roomStopReason,
  startButtonLabel,
  startRoomFailure,
} from "./room";

describe("directServer", () => {
  it("dials loopback in the clear, because the socket never leaves the machine", () => {
    const server = directServer(8200);
    expect(server.host).toBe("127.0.0.1");
    expect(server.port).toBe(8200);
    expect(server.tls).toBe(false);
    expect(server.protocol).toBe("tasserver");
  });

  it("produces a key the store recognises as a room", () => {
    // The store keys a connection `username@host:port` (see `serverKeyFor`).
    const server = directServer(8200);
    expect(isDirectKey(`Tom@${server.host}:${server.port}`)).toBe(true);
  });
});

describe("isDirectKey", () => {
  it("does not mistake a real server for a room", () => {
    expect(isDirectKey("Tom@lobby.beyondallreason.info:8200")).toBe(false);
  });

  it("reads no connection as no room", () => {
    expect(isDirectKey(null)).toBe(false);
  });
});

describe("startRoomFailure", () => {
  // The wording differs per platform, and a host meets this failure more than any
  // other, so both families have to reach the same sentence.
  it("names the port and what to do about it on unix", () => {
    const message = startRoomFailure(
      new Error(
        "cannot listen on port 8200: Address already in use (os error 48)",
      ),
      8200,
    );
    expect(message).toContain("Port 8200 is already in use");
    expect(message).toContain("Pick another port");
  });

  it("recognises the same failure in Windows's words", () => {
    const message = startRoomFailure(
      "cannot listen on port 8200: Only one usage of each socket address is normally permitted. (os error 10048)",
      8200,
    );
    expect(message).toContain("Port 8200 is already in use");
  });

  it("passes anything else through rather than guessing", () => {
    expect(startRoomFailure(new Error("permission denied"), 80)).toBe(
      "permission denied",
    );
  });

  it("still says something when the failure carried no words", () => {
    expect(startRoomFailure(null, 8200)).toBe(
      "Could not start a room on port 8200.",
    );
  });
});

describe("roomStopReason", () => {
  it("names the host, so the drop is not anonymous", () => {
    expect(roomStopReason("Tom")).toBe("Tom closed this room");
  });

  it("falls back to a reason rather than an empty message", () => {
    expect(roomStopReason("  ")).toBe("the host closed this room");
  });
});

describe("startButtonLabel", () => {
  it("says a press landed, so nobody presses twice", () => {
    expect(startButtonLabel(true, true)).toBe("Starting…");
  });

  it("says what it is waiting on before the hashes land", () => {
    expect(startButtonLabel(false, false)).toBe("Reading content…");
  });

  it("offers the start once there is something to start", () => {
    expect(startButtonLabel(false, true)).toBe("Start room");
  });
});

describe("normalizeRoomPort", () => {
  it("keeps a real port", () => {
    expect(normalizeRoomPort(8452)).toBe(8452);
  });

  it("refuses port 0, which a host could not pass on to a joiner", () => {
    expect(normalizeRoomPort(0)).toBe(1);
  });

  it("clamps above the range a socket can bind", () => {
    expect(normalizeRoomPort(99999)).toBe(65535);
  });

  it("falls back to the default when the field is empty", () => {
    expect(normalizeRoomPort(Number.NaN)).toBe(DEFAULT_ROOM_PORT);
  });
});
