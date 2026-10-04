// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { parseDeepLink } from "../../deeplink/parse";
import { inviteLink } from "../../direct/invite";
import type { LobbyServer } from "../../lobby-servers/config";
import {
  serverAddressFromKey,
  serverHostFromKey,
  serverKeyFor,
} from "../store";
import {
  type InviteConnection,
  inviteLinkFrom,
  inviteOffer,
} from "./inviteOffer";

/**
 * A lobby server saved under an IPv6 address (issue #3407). The saved host is
 * written with or without brackets, because the port is a field of its own
 * there, and both have to give a link that finds the same server again.
 */

const ADDRESSES = [
  ["loopback", "::1", "[::1]"],
  ["full", "2001:0db8:0000:0000:0000:0000:0000:0001", "[2001:db8::1]"],
  ["compressed", "2001:db8::1", "[2001:db8::1]"],
  ["IPv4-mapped", "::ffff:1.2.3.4", "[::ffff:102:304]"],
] as const;

function saved(host: string): LobbyServer {
  return {
    id: "mine",
    name: "Mine",
    host,
    port: 8200,
    tls: false,
    allowSelfSigned: false,
  };
}

function connection(serverKey: string): InviteConnection {
  return {
    serverKey,
    direct: false,
    live: true,
    opening: false,
    ready: true,
    inBattle: false,
  };
}

describe("a saved server's invite link", () => {
  for (const [label, bare, shown] of ADDRESSES) {
    for (const host of [bare, `[${bare}]`]) {
      it(`parses back and matches the saved ${label} server written as ${host}`, () => {
        const server = saved(host);
        const link = inviteLink(
          serverAddressFromKey(serverKeyFor(server, "me")),
          false,
          "7",
        );
        expect(link).not.toBeNull();

        const action = parseDeepLink(link ?? "");
        expect(action?.kind).toBe("join");
        if (action?.kind !== "join") return;
        const invite = inviteLinkFrom(action);
        expect(invite?.address).toBe(`${shown}:8200`);

        const offer = inviteOffer(
          invite ?? ({} as never),
          [server],
          [],
          null,
          [],
        );
        expect(offer.kind).toBe("login");
      });

      it(`recognises an open connection to the ${label} server written as ${host}`, () => {
        const server = saved(host);
        const key = serverKeyFor(server, "me");
        const action = parseDeepLink(
          inviteLink(serverAddressFromKey(key), false, "7") ?? "",
        );
        expect(action?.kind).toBe("join");
        if (action?.kind !== "join") return;
        const invite = inviteLinkFrom(action);
        const offer = inviteOffer(invite ?? ({} as never), [server], [], null, [
          connection(key),
        ]);
        expect(offer.kind).toBe("join");
      });
    }
  }

  it("gives a room a joiner is in, typed or from a link, the same room link", () => {
    for (const key of ["AF@2001:db8::1:8200", "AF@[2001:db8::1]:8200"]) {
      expect(inviteLink(serverAddressFromKey(key), true, "1"), key).toBe(
        "coilbox://room?address=%5B2001%3Adb8%3A%3A1%5D&port=8200",
      );
    }
  });

  it("leaves IPv4 and hostname servers as they were", () => {
    for (const host of ["192.168.1.45", "Lobby.Example.com"]) {
      const key = serverKeyFor(saved(host), "me");
      expect(key).toBe(`me@${host}:8200`);
      expect(serverAddressFromKey(key)).toBe(`${host}:8200`);
      expect(serverHostFromKey(key)).toBe(host.toLowerCase());
    }
  });
});

describe("what the normaliser makes of the odd addresses", () => {
  it("does not read an IPv4-mapped server as the plain IPv4 one", () => {
    const mapped = inviteLinkFrom({
      server: "[::ffff:1.2.3.4]:8200",
      battle: "7",
    });
    const plain = inviteLinkFrom({ server: "1.2.3.4:8200", battle: "7" });
    expect(mapped?.address).toBe("[::ffff:102:304]:8200");
    expect(plain?.address).toBe("1.2.3.4:8200");
  });

  it("offers no link for a server with a zone id, and does not throw", () => {
    for (const host of ["fe80::1%eth0", "[fe80::1%eth0]"]) {
      const key = serverKeyFor(saved(host), "me");
      expect(() =>
        inviteLink(serverAddressFromKey(key), false, "7"),
      ).not.toThrow();
      expect(inviteLink(serverAddressFromKey(key), false, "7")).toBeNull();
    }
  });
});
