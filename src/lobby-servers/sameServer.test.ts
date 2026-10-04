import { describe, expect, it } from "vitest";
import {
  hostIdentity,
  hostOfKey,
  keyIsOnServer,
  serverForKey,
} from "./sameServer";

const at = (host: string, port = 8200) => ({ host, port });

describe("keyIsOnServer", () => {
  it("matches a key spelled as the saved server is", () => {
    expect(
      keyIsOnServer("me@lobby.example.com:8200", at("lobby.example.com")),
    ).toBe(true);
  });

  it("matches the other spellings of one address", () => {
    const pairs = [
      ["::1", "me@[::1]:8200"],
      ["[::1]", "me@::1:8200"],
      ["Lobby.Example.com", "me@lobby.example.com:8200"],
      ["lobby.example.com.", "me@lobby.example.com:8200"],
      ["lobby.example.com", "me@lobby.example.com.:8200"],
      ["0x7f.0.0.1", "me@127.0.0.1:8200"],
      ["127.0.0.1", "me@2130706433:8200"],
    ];
    for (const [saved, key] of pairs) {
      expect(keyIsOnServer(key, at(saved)), `${saved} ${key}`).toBe(true);
    }
  });

  it("does not match another port or another host", () => {
    expect(keyIsOnServer("me@[::1]:8201", at("::1"))).toBe(false);
    expect(keyIsOnServer("me@[::2]:8200", at("::1"))).toBe(false);
    expect(keyIsOnServer("me@127.0.0.1:8200", at("127.0.0.2"))).toBe(false);
  });

  it("does not read an IPv4-mapped address as the plain IPv4 one", () => {
    expect(keyIsOnServer("me@1.2.3.4:8200", at("::ffff:1.2.3.4"))).toBe(false);
  });

  it("matches a host the normaliser refuses by its exact text", () => {
    for (const host of ["fe80::1%eth0", "my_lobby.example", "bücher.example"]) {
      expect(keyIsOnServer(`me@${host}:8200`, at(host)), host).toBe(true);
    }
  });

  it("keeps two such hosts apart when their text differs", () => {
    expect(keyIsOnServer("me@fe80::1%eth1:8200", at("fe80::1%eth0"))).toBe(
      false,
    );
    expect(
      keyIsOnServer("me@my_lobby.example:8200", at("my-lobby.example")),
    ).toBe(false);
    expect(keyIsOnServer("me@Bücher.example:8200", at("bücher.example"))).toBe(
      false,
    );
  });

  it("splits a username with an @ in it at the last one", () => {
    expect(keyIsOnServer("me@home@[::1]:8200", at("::1"))).toBe(true);
    expect(keyIsOnServer("me@home.example:8200@[::1]:8200", at("::1"))).toBe(
      true,
    );
    expect(keyIsOnServer("me@[::1]:8200@[::2]:8200", at("::1"))).toBe(false);
  });
});

describe("serverForKey", () => {
  const entry = (id: string, host: string, tls = false) => ({
    id,
    host,
    port: 8200,
    tls,
  });

  it("finds the entry a key matches once normalised", () => {
    expect(serverForKey("me@[::1]:8200", [entry("a", "::1")])?.id).toBe("a");
  });

  it("returns nothing for a server that is not saved", () => {
    expect(serverForKey("me@[::2]:8200", [entry("a", "::1")])).toBeUndefined();
  });

  it("gives a key the entry it was built from when one server is saved under two spellings", () => {
    // A login is saved against its own entry, so a key made from the second
    // entry has to find the second entry and not the first.
    const servers = [entry("a", "[::1]", true), entry("b", "::1", false)];
    expect(serverForKey("me@::1:8200", servers)?.id).toBe("b");
    expect(serverForKey("me@[::1]:8200", servers)?.id).toBe("a");
  });

  it("gives a key the entry spelled as it is when two share one spelling", () => {
    const servers = [entry("a", "::1", true), entry("b", "::1", false)];
    expect(serverForKey("me@::1:8200", servers)?.id).toBe("a");
  });

  it("falls back to the normalised match when no entry is spelled as the key is", () => {
    const servers = [
      entry("a", "Lobby.Example.com"),
      entry("b", "other.example"),
    ];
    expect(serverForKey("me@lobby.example.com.:8200", servers)?.id).toBe("a");
  });
});

describe("hostIdentity and hostOfKey", () => {
  it("gives every spelling of one host the same form", () => {
    expect(hostIdentity("::1")).toBe("[::1]");
    expect(hostIdentity("[::1]")).toBe("[::1]");
    expect(hostIdentity("Lobby.Example.com.")).toBe("lobby.example.com");
    expect(hostIdentity("0x7f.0.0.1")).toBe("127.0.0.1");
  });

  it("reads a refused host as its lower-cased text, in brackets for IPv6", () => {
    expect(hostIdentity("My_Lobby.example")).toBe("my_lobby.example");
    expect(hostIdentity("fe80::1%eth0")).toBe("[fe80::1%eth0]");
    expect(hostIdentity("[fe80::1%eth0]")).toBe("[fe80::1%eth0]");
  });

  it("gives the host of a key and of a saved entry the same form", () => {
    expect(hostOfKey("me@fe80::1%eth0:8200")).toBe(
      hostIdentity("fe80::1%eth0"),
    );
    expect(hostOfKey("me@my_lobby.example:8200")).toBe(
      hostIdentity("my_lobby.example"),
    );
    expect(hostOfKey("me@[::1]:8200")).toBe(hostIdentity("::1"));
  });

  it("does not depend on the port", () => {
    expect(hostOfKey("me@lobby.example.com:8200")).toBe(
      hostOfKey("me@lobby.example.com:443"),
    );
  });
});
