import { describe, expect, it } from "vitest";
import { type ConnectionState, newConnection } from "./connections";
import { lobbyDotStatus } from "./loginStatus";

function entry(
  serverKey: string,
  opts: {
    live?: boolean;
    phase?: ConnectionState["mirror"]["phase"];
    error?: string | null;
    away?: boolean;
    direct?: boolean;
  } = {},
): ConnectionState {
  const base = newConnection(serverKey, opts.direct ?? false);
  return {
    ...base,
    live: opts.live ?? false,
    mirror: {
      ...base.mirror,
      phase: opts.phase ?? null,
      error: opts.error ?? null,
    },
    status: { ingame: false, away: opts.away ?? false },
  };
}

const all = (...entries: ConnectionState[]) =>
  Object.fromEntries(entries.map((e) => [e.serverKey, e]));

const A = "AF@a:8200";
const B = "AF@b:8200";

describe("lobbyDotStatus", () => {
  it("is off with no connections", () => {
    expect(lobbyDotStatus({}, false)).toBe("off");
  });

  it("is connecting while a connect is in flight or a live one is not ready", () => {
    expect(lobbyDotStatus({}, true)).toBe("connecting");
    expect(lobbyDotStatus(all(entry(A, { live: true })), false)).toBe(
      "connecting",
    );
  });

  it("is connected when any connection is up, even beside one that failed", () => {
    expect(
      lobbyDotStatus(
        all(
          entry(A, { live: true, phase: "ready" }),
          entry(B, { error: "connection reset" }),
        ),
        false,
      ),
    ).toBe("on");
  });

  it("is away only when every ready connection is away", () => {
    const awayA = entry(A, { live: true, phase: "ready", away: true });
    expect(lobbyDotStatus(all(awayA), false)).toBe("away");
    expect(
      lobbyDotStatus(
        all(awayA, entry(B, { live: true, phase: "ready" })),
        false,
      ),
    ).toBe("on");
  });

  it("is an error only when every connection has failed", () => {
    expect(
      lobbyDotStatus(
        all(
          entry(A, { error: "connection reset" }),
          entry(B, { phase: "denied" }),
        ),
        false,
      ),
    ).toBe("error");
    expect(
      lobbyDotStatus(all(entry(A, { error: "connection reset" })), true),
    ).toBe("connecting");
  });

  // A LAN or direct-address room is not a lobby login (issue #2850), so it must
  // not turn the dot on (issue #2904).
  it("ignores a room, live or otherwise, when no login is connected", () => {
    const readyRoom = entry(A, { live: true, phase: "ready", direct: true });
    expect(lobbyDotStatus(all(readyRoom), false)).toBe("off");
    const openingRoom = entry(A, {
      live: true,
      phase: "awaitGreeting",
      direct: true,
    });
    expect(lobbyDotStatus(all(openingRoom), false)).toBe("off");
  });

  it("reports the login's status beside a live room", () => {
    const room = entry(A, { live: true, phase: "ready", direct: true });
    const login = entry(B, { live: true, phase: "ready" });
    expect(lobbyDotStatus(all(room, login), false)).toBe("on");
  });
});
