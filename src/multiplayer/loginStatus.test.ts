import { describe, expect, it } from "vitest";
import { type ConnectionState, newConnection } from "./connections";
import { lobbyDotStatus, refusedReason } from "./loginStatus";

function entry(
  serverKey: string,
  opts: {
    live?: boolean;
    phase?: ConnectionState["mirror"]["phase"];
    error?: string | null;
    loginError?: string | null;
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
      loginError: opts.loginError ?? null,
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

describe("a refused password", () => {
  it("is a refusal when every login left was refused", () => {
    expect(
      lobbyDotStatus(
        all(
          entry(A, { loginError: "invalid password" }),
          entry(B, { loginError: "invalid password" }),
        ),
        false,
      ),
    ).toBe("refused");
  });

  it("is an error when the refusal was for another reason than the password", () => {
    expect(
      lobbyDotStatus(
        all(entry(A, { loginError: "Already logged in." })),
        false,
      ),
    ).toBe("error");
    expect(
      lobbyDotStatus(
        all(
          entry(A, { loginError: "invalid password" }),
          entry(B, { loginError: "Already logged in." }),
        ),
        false,
      ),
    ).toBe("error");
  });

  it("is an error when the server refused without giving a reason", () => {
    expect(lobbyDotStatus(all(entry(A, { phase: "denied" })), false)).toBe(
      "error",
    );
  });

  it("is still an error when one login failed another way beside a refusal", () => {
    expect(
      lobbyDotStatus(
        all(
          entry(A, { loginError: "invalid password" }),
          entry(B, { error: "connection reset" }),
        ),
        false,
      ),
    ).toBe("error");
  });

  it("does not turn the dot red beside a working login", () => {
    expect(
      lobbyDotStatus(
        all(
          entry(A, { live: true, phase: "ready" }),
          entry(B, { loginError: "invalid password" }),
        ),
        false,
      ),
    ).toBe("on");
  });

  it("gives the server's reason, and none for a login that is up", () => {
    expect(refusedReason(entry(A, { loginError: "invalid password" }))).toBe(
      "invalid password",
    );
    expect(refusedReason(entry(A, { error: "connection reset" }))).toBeNull();
    expect(
      refusedReason(
        entry(A, { live: true, phase: "ready", loginError: "stale" }),
      ),
    ).toBeNull();
  });
});
