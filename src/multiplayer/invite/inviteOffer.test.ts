import { describe, expect, it } from "vitest";
import { MAX_FIELD_LENGTH } from "../../deeplink/parse";
import type { LobbyAccount, LobbyServer } from "../../lobby-servers/config";
import {
  type InviteConnection,
  type InviteLink,
  intentStep,
  inviteLinkFrom,
  inviteOffer,
  newIntent,
} from "./inviteOffer";

const official: LobbyServer = {
  id: "official",
  name: "Official",
  host: "lobby.example.com",
  port: 8200,
  tls: true,
  tlsStyle: "direct",
  allowSelfSigned: false,
  builtin: true,
};
const other: LobbyServer = {
  id: "other",
  name: "Other",
  host: "other.example",
  port: 8200,
  tls: false,
  allowSelfSigned: false,
};
const servers = [official, other];

const alice: LobbyAccount = {
  id: "a1",
  serverId: "official",
  username: "alice",
  hasSecret: true,
};
const bobElsewhere: LobbyAccount = {
  id: "a2",
  serverId: "other",
  username: "bob",
  hasSecret: true,
};

function link(server: string, battle = "42", password?: string): InviteLink {
  const made = inviteLinkFrom({ server, battle, password });
  if (!made) throw new Error(`not a link: ${server}`);
  return made;
}

function conn(
  serverKey: string,
  patch: Partial<InviteConnection> = {},
): InviteConnection {
  return {
    serverKey,
    direct: false,
    live: true,
    opening: false,
    ready: true,
    inBattle: false,
    ...patch,
  };
}

const offer = (
  l: InviteLink,
  accounts: LobbyAccount[] = [],
  connections: InviteConnection[] = [],
  catalog: LobbyServer[] = servers,
) => inviteOffer(l, catalog, accounts, null, connections);

describe("inviteLinkFrom", () => {
  it("reads the server and the battle", () => {
    expect(
      inviteLinkFrom({ server: "lobby.example.com:8200", battle: "42" }),
    ).toEqual({
      host: "lobby.example.com",
      port: 8200,
      address: "lobby.example.com:8200",
      battle: 42,
    });
  });

  // Threat 5. The parser has already refused these, and this refuses them
  // again, so a link that reached here some other way is no better off.
  it("refuses a battle that is not a number the join command holds", () => {
    for (const battle of ["4a", "42 1", "42\nX", "", "-1", "4294967296"]) {
      expect(
        inviteLinkFrom({ server: "lobby.example.com:8200", battle }),
        JSON.stringify(battle),
      ).toBeNull();
    }
  });

  it("refuses an empty password and one longer than a field may be", () => {
    for (const password of ["", "x".repeat(MAX_FIELD_LENGTH + 1)]) {
      expect(
        inviteLinkFrom({
          server: "lobby.example.com:8200",
          battle: "42",
          password,
        }),
        JSON.stringify(password.slice(0, 20)),
      ).toBeNull();
    }
  });

  it("keeps a password the TASServer rule would refuse, for the join to judge", () => {
    expect(
      inviteLinkFrom({
        server: "lobby.example.com:8200",
        battle: "42",
        password: "two words",
      }),
    ).toMatchObject({ password: "two words" });
  });

  it("refuses a server that is not a host and a port", () => {
    for (const server of [
      "lobby.example.com",
      "lobby.example.com@evil.example:8200",
      "lobby.еxample.com:8200",
    ]) {
      expect(inviteLinkFrom({ server, battle: "42" }), server).toBeNull();
    }
  });
});

describe("inviteOffer", () => {
  // Threat 1.
  describe("a server coilbox has not heard of", () => {
    it("is offered by its address, with nothing to connect with", () => {
      expect(offer(link("evil.example:8200"), [alice, bobElsewhere])).toEqual({
        kind: "unknown",
        address: "evil.example:8200",
        host: "evil.example",
        port: 8200,
      });
    });

    it("shows the address in the form it is compared in", () => {
      expect(offer(link("EVIL.Example.:08200"))).toMatchObject({
        kind: "unknown",
        address: "evil.example:8200",
      });
    });
  });

  // Threat 2.
  describe("a link passing itself off as a known server", () => {
    it("matches a known server whatever the case or trailing dot", () => {
      for (const raw of [
        "lobby.example.com:8200",
        "LOBBY.Example.COM:8200",
        "lobby.example.com.:8200",
      ]) {
        expect(offer(link(raw), [alice]), raw).toMatchObject({
          kind: "connect",
          address: "lobby.example.com:8200",
        });
      }
    });

    it("is unknown on another port of a known host", () => {
      expect(offer(link("lobby.example.com:8201"), [alice]).kind).toBe(
        "unknown",
      );
    });

    it("is unknown when a known host is only part of its name", () => {
      for (const raw of [
        "lobby.example.com.evil.example:8200",
        "evil-lobby.example.com:8200",
        "xn--lobby-example-com.evil.example:8200",
        "lobby.example.co:8200",
      ]) {
        expect(offer(link(raw), [alice]).kind, raw).toBe("unknown");
      }
    });

    it("is unknown when a saved server only shares its display name", () => {
      const impostor: LobbyServer = {
        ...other,
        id: "impostor",
        name: "lobby.example.com:8200",
        host: "evil.example",
      };
      expect(
        offer(link("evil.example:8200"), [alice], [], [official, impostor]),
      ).toMatchObject({ kind: "login", server: impostor, account: null });
    });

    it("matches a known server saved by IP however the link spells it", () => {
      const byIp: LobbyServer = { ...other, id: "ip", host: "127.0.0.1" };
      const mine: LobbyAccount = { ...alice, serverId: "ip" };
      expect(offer(link("2130706433:8200"), [mine], [], [byIp])).toMatchObject({
        kind: "connect",
        address: "127.0.0.1:8200",
      });
    });
  });

  // Threat 3.
  describe("saved credentials", () => {
    it("are never offered to a server other than their own", () => {
      const o = offer(link("other.example:8200"), [alice]);
      expect(o).toEqual({
        kind: "login",
        address: "other.example:8200",
        server: other,
        account: null,
      });
    });

    it("are not offered to an unknown server that looks like their own", () => {
      const o = offer(link("lobby.example.com:8201"), [alice]);
      expect(o.kind).toBe("unknown");
      expect(o).not.toHaveProperty("account");
      expect(o).not.toHaveProperty("server");
    });

    it("connect through the saved server itself, TLS and all", () => {
      const o = offer(link("lobby.example.com:8200"), [alice]);
      expect(o.kind).toBe("connect");
      if (o.kind !== "connect") return;
      // The saved entry, not one rebuilt from the link, so there is no field
      // of the link that could turn TLS off.
      expect(o.server).toBe(official);
      expect(o.server.tls).toBe(true);
      expect(o.server.tlsStyle).toBe("direct");
      expect(o.account).toBe(alice);
    });

    it("go with their own entry when two entries share an address", () => {
      // A plaintext copy of a TLS server at the same address. The account
      // saved against the TLS entry must not be sent through the plaintext one.
      const plaintext: LobbyServer = {
        ...official,
        id: "plaintext",
        name: "Copy",
        tls: false,
        tlsStyle: undefined,
        builtin: undefined,
      };
      const o = offer(
        link("lobby.example.com:8200"),
        [alice],
        [],
        [plaintext, official],
      );
      expect(o.kind).toBe("connect");
      if (o.kind !== "connect") return;
      expect(o.server).toBe(official);
      expect(o.account).toBe(alice);
    });

    it("pick the most recently used of several logins on the server", () => {
      const older: LobbyAccount = { ...alice, id: "a0", lastUsedAt: 1 };
      const newer: LobbyAccount = {
        ...alice,
        id: "a9",
        username: "alice2",
        lastUsedAt: 2,
      };
      expect(
        offer(link("lobby.example.com:8200"), [older, newer]),
      ).toMatchObject({ kind: "connect", account: newer });
    });

    it("send a login with no saved password to the login screen", () => {
      const bare: LobbyAccount = { ...alice, hasSecret: false };
      expect(offer(link("lobby.example.com:8200"), [bare])).toEqual({
        kind: "login",
        address: "lobby.example.com:8200",
        server: official,
        account: bare,
      });
    });

    it("send a browser sign-in to the login screen rather than opening one", () => {
      const tachyon: LobbyServer = {
        ...official,
        id: "tachyon",
        protocol: "tachyon",
      };
      const mine: LobbyAccount = { ...alice, serverId: "tachyon" };
      expect(
        offer(link("lobby.example.com:8200"), [mine], [], [tachyon]),
      ).toMatchObject({ kind: "login", server: tachyon, account: mine });
    });
  });

  describe("a known server with no saved login", () => {
    it("is offered the login screen for that server", () => {
      expect(offer(link("lobby.example.com:8200"), [bobElsewhere])).toEqual({
        kind: "login",
        address: "lobby.example.com:8200",
        server: official,
        account: null,
      });
    });
  });

  describe("a server already connected to", () => {
    it("is offered the join alone", () => {
      expect(
        offer(
          link("lobby.example.com:8200"),
          [alice],
          [conn("alice@lobby.example.com:8200")],
        ),
      ).toEqual({
        kind: "join",
        address: "lobby.example.com:8200",
        serverName: "Official",
        serverKey: "alice@lobby.example.com:8200",
        ready: true,
        leavesKey: null,
      });
    });

    it("waits for a login still opening rather than starting a second", () => {
      expect(
        offer(
          link("lobby.example.com:8200"),
          [alice],
          [
            conn("alice@lobby.example.com:8200", {
              live: false,
              opening: true,
              ready: false,
            }),
          ],
        ),
      ).toMatchObject({ kind: "join", ready: false });
    });

    it("does not count a connection that has dropped", () => {
      expect(
        offer(
          link("lobby.example.com:8200"),
          [alice],
          [
            conn("alice@lobby.example.com:8200", {
              live: false,
              ready: false,
            }),
          ],
        ).kind,
      ).toBe("connect");
    });

    it("does not count a room at the same address, which is not a lobby server", () => {
      expect(
        offer(
          link("lobby.example.com:8200"),
          [alice],
          [conn("alice@lobby.example.com:8200", { direct: true })],
        ).kind,
      ).toBe("connect");
    });

    it("does not count a connection to the same host on another port", () => {
      expect(
        offer(
          link("lobby.example.com:8200"),
          [alice],
          [conn("alice@lobby.example.com:443")],
        ).kind,
      ).toBe("connect");
    });

    it("names the battle joining would leave", () => {
      expect(
        offer(
          link("lobby.example.com:8200"),
          [alice],
          [
            conn("alice@lobby.example.com:8200"),
            conn("bob@other.example:8200", { inBattle: true }),
          ],
        ),
      ).toMatchObject({ kind: "join", leavesKey: "bob@other.example:8200" });
      expect(
        offer(
          link("lobby.example.com:8200"),
          [alice],
          [conn("bob@other.example:8200", { inBattle: true })],
        ),
      ).toMatchObject({ kind: "connect", leavesKey: "bob@other.example:8200" });
    });
  });

  // Threat 4. Every answer is something to offer. None of them is a
  // connection, and the one that would use a saved password is its own kind
  // so the screen can put it behind a button.
  it("only ever answers with something to offer", () => {
    const kinds = [
      offer(link("lobby.example.com:8200"), [alice]).kind,
      offer(link("lobby.example.com:8200")).kind,
      offer(link("evil.example:8200"), [alice]).kind,
      offer(
        link("lobby.example.com:8200"),
        [alice],
        [conn("alice@lobby.example.com:8200")],
      ).kind,
    ];
    expect(kinds).toEqual(["connect", "login", "unknown", "join"]);
  });
});

// Threat 7.
describe("intentStep", () => {
  const l = link("lobby.example.com:8200");
  const intent = (connections: InviteConnection[] = []) =>
    newIntent(l, connections, null);

  it("waits while nothing is connected", () => {
    expect(intentStep(intent(), [])).toEqual({ kind: "wait" });
  });

  it("is ready once the server it was made for is logged in", () => {
    expect(
      intentStep(intent(), [conn("alice@lobby.example.com:8200")]),
    ).toEqual({ kind: "ready", serverKey: "alice@lobby.example.com:8200" });
  });

  it("waits while that server's login is still going through", () => {
    expect(
      intentStep(intent(), [
        conn("alice@lobby.example.com:8200", { ready: false }),
      ]),
    ).toEqual({ kind: "wait" });
  });

  it("is dropped when the player connects somewhere else", () => {
    expect(intentStep(intent(), [conn("bob@other.example:8200")])).toEqual({
      kind: "elsewhere",
      serverKey: "bob@other.example:8200",
    });
  });

  it("is dropped for another port of the same host, which is another server", () => {
    expect(intentStep(intent(), [conn("alice@lobby.example.com:443")])).toEqual(
      { kind: "elsewhere", serverKey: "alice@lobby.example.com:443" },
    );
  });

  it("is not dropped by a connection that was already open when it was made", () => {
    const before = [conn("bob@other.example:8200")];
    expect(intentStep(intent(before), before)).toEqual({ kind: "wait" });
    expect(
      intentStep(intent(before), [
        ...before,
        conn("alice@lobby.example.com:8200"),
      ]),
    ).toMatchObject({ kind: "ready" });
  });

  it("is not finished by a room at the same address", () => {
    expect(
      intentStep(intent(), [
        conn("alice@lobby.example.com:8200", { direct: true }),
      ]),
    ).toEqual({ kind: "wait" });
  });

  it("keeps waiting when that server's connection has dropped", () => {
    expect(
      intentStep(intent(), [
        conn("alice@lobby.example.com:8200", { live: false, ready: false }),
      ]),
    ).toEqual({ kind: "wait" });
  });

  it("goes to the server it was made for when two finish together", () => {
    expect(
      intentStep(intent(), [
        conn("bob@other.example:8200"),
        conn("alice@lobby.example.com:8200"),
      ]),
    ).toMatchObject({ kind: "ready" });
  });
});
