import { describe, expect, it } from "vitest";
import type { LobbyServer } from "../lobby-servers/config";
import type { LobbyState } from "./bindings";
import type { Connections } from "./connections";
import { isUberserver, serverAdminKeys } from "./serverAdmin";

const UBER_KEY = "mod@uber.example:8200";
const TEI_KEY = "mod@tei.example:8201";
const ZEROK_KEY = "mod@zk.example:8200";
const PLAIN_KEY = "player@uber.example:8200";
const ROOM_KEY = "host@10.0.0.1:8452";

const servers: LobbyServer[] = [
  {
    id: "uber",
    name: "Uberserver",
    host: "uber.example",
    port: 8200,
    tls: false,
    allowSelfSigned: false,
    protocol: "tasserver",
  },
  {
    id: "tei",
    name: "Teiserver",
    host: "tei.example",
    port: 8201,
    tls: true,
    allowSelfSigned: false,
    protocol: "tasserver",
  },
  {
    id: "zk",
    name: "Zero-K",
    host: "zk.example",
    port: 8200,
    tls: false,
    allowSelfSigned: false,
    protocol: "zerok",
  },
];

function state(compflags: string[], me: string, access: boolean): LobbyState {
  return {
    myUsername: me,
    compflags,
    users: {
      [me]: {
        name: me,
        country: "",
        userId: "1",
        agent: "",
        status: { ingame: false, away: false, rank: 0, access, bot: false },
        rating: {},
      },
    },
  } as unknown as LobbyState;
}

function connection(
  serverKey: string,
  over: { live?: boolean; direct?: boolean; state?: LobbyState | null } = {},
) {
  return {
    serverKey,
    live: over.live ?? true,
    direct: over.direct ?? false,
    mirror: { state: over.state ?? null },
  };
}

describe("isUberserver", () => {
  it("is true for a TASServer connection whose compflags lack teiserver", () => {
    expect(
      isUberserver("tasserver", state(["u", "sp", "b"], "mod", true)),
    ).toBe(true);
  });

  it("is false for a TASServer connection whose compflags name teiserver", () => {
    expect(
      isUberserver(
        "tasserver",
        state(["sp", "teiserver", "matchmaking", "token-auth"], "mod", true),
      ),
    ).toBe(false);
  });

  it("is false for Tachyon, whatever its compflags", () => {
    expect(isUberserver("tachyon", state([], "mod", true))).toBe(false);
  });

  it("is false for Zero-K, whatever its compflags", () => {
    expect(isUberserver("zerok", state([], "mod", true))).toBe(false);
  });

  it("reads a TASServer connection with no compflags yet as uberserver, since nothing has proven it Teiserver", () => {
    expect(isUberserver("tasserver", null)).toBe(true);
  });
});

describe("serverAdminKeys", () => {
  it("includes a live uberserver login whose account has the access bit", () => {
    const connections: Connections = {
      [UBER_KEY]: connection(UBER_KEY, {
        state: state(["u", "sp", "b"], "mod", true),
      }),
    } as unknown as Connections;
    expect(serverAdminKeys(connections, servers, null)).toEqual([UBER_KEY]);
  });

  it("excludes a normal account on uberserver with no access bit", () => {
    const connections: Connections = {
      [PLAIN_KEY]: connection(PLAIN_KEY, {
        state: state(["u", "sp", "b"], "player", false),
      }),
    } as unknown as Connections;
    expect(serverAdminKeys(connections, servers, null)).toEqual([]);
  });

  it("excludes a moderator on Teiserver", () => {
    const connections: Connections = {
      [TEI_KEY]: connection(TEI_KEY, {
        state: state(["sp", "teiserver"], "mod", true),
      }),
    } as unknown as Connections;
    expect(serverAdminKeys(connections, servers, null)).toEqual([]);
  });

  it("excludes a moderator-flagged account on Zero-K", () => {
    const connections: Connections = {
      [ZEROK_KEY]: connection(ZEROK_KEY, {
        state: state([], "mod", true),
      }),
    } as unknown as Connections;
    expect(serverAdminKeys(connections, servers, null)).toEqual([]);
  });

  it("excludes a connection that has not finished connecting", () => {
    const connections: Connections = {
      [UBER_KEY]: connection(UBER_KEY, {
        live: false,
        state: state(["u", "sp", "b"], "mod", true),
      }),
    } as unknown as Connections;
    expect(serverAdminKeys(connections, servers, null)).toEqual([]);
  });

  it("excludes a LAN room, which is not a lobby login", () => {
    const connections: Connections = {
      [ROOM_KEY]: connection(ROOM_KEY, {
        direct: true,
        state: state(["u", "sp", "b"], "mod", true),
      }),
    } as unknown as Connections;
    expect(serverAdminKeys(connections, servers, null)).toEqual([]);
  });

  it("puts the focused connection first when more than one qualifies", () => {
    const connections: Connections = {
      [UBER_KEY]: connection(UBER_KEY, {
        state: state(["u", "sp", "b"], "mod", true),
      }),
      [TEI_KEY]: connection(TEI_KEY, {
        state: state(["sp", "teiserver"], "mod2", true),
      }),
    } as unknown as Connections;
    // Give Teiserver's own admin flag no effect either: only the uberserver
    // connection qualifies, so focus order is moot with one candidate. Add a
    // second uberserver connection to prove ordering.
    const secondUberKey = "mod2@uber2.example:8200";
    const withSecond: Connections = {
      ...connections,
      [secondUberKey]: connection(secondUberKey, {
        state: state(["u", "sp", "b"], "mod2", true),
      }),
    } as unknown as Connections;
    expect(serverAdminKeys(withSecond, servers, secondUberKey)[0]).toBe(
      secondUberKey,
    );
  });
});
