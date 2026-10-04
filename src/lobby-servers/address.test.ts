import { describe, expect, it } from "vitest";
import { normaliseHostPort, normaliseServerAddress } from "./address";

describe("normaliseServerAddress", () => {
  it("reads a host and a port", () => {
    expect(normaliseServerAddress("lobby.example.com:8200")).toEqual({
      host: "lobby.example.com",
      port: 8200,
      address: "lobby.example.com:8200",
    });
  });

  it("lower-cases the host", () => {
    expect(normaliseServerAddress("Lobby.EXAMPLE.com:8200")?.address).toBe(
      "lobby.example.com:8200",
    );
  });

  it("drops one trailing dot, which names the same host", () => {
    expect(normaliseServerAddress("lobby.example.com.:8200")?.address).toBe(
      "lobby.example.com:8200",
    );
  });

  it("writes a port without leading zeros", () => {
    expect(normaliseServerAddress("lobby.example.com:08200")?.port).toBe(8200);
  });

  it("refuses an address with no port", () => {
    expect(normaliseServerAddress("lobby.example.com")).toBeNull();
  });

  it("refuses a port outside the range", () => {
    expect(normaliseServerAddress("lobby.example.com:0")).toBeNull();
    expect(normaliseServerAddress("lobby.example.com:65536")).toBeNull();
    expect(normaliseServerAddress("lobby.example.com:123456")).toBeNull();
    expect(normaliseServerAddress("lobby.example.com:-1")).toBeNull();
    expect(normaliseServerAddress("lobby.example.com:80a")).toBeNull();
  });

  it("refuses userinfo, which would show one host and dial another", () => {
    expect(
      normaliseServerAddress("lobby.example.com@evil.example:8200"),
    ).toBeNull();
    expect(normaliseServerAddress("user:pw@lobby.example.com:8200")).toBeNull();
  });

  it("refuses a path, a query, a fragment and an escape", () => {
    for (const raw of [
      "lobby.example.com/evil.example:8200",
      "evil.example:8200/lobby.example.com",
      "lobby.example.com\\evil.example:8200",
      "lobby.example.com?x:8200",
      "lobby.example.com#x:8200",
      "lobby%2eexample.com:8200",
      "http://lobby.example.com:8200",
    ]) {
      expect(normaliseServerAddress(raw), raw).toBeNull();
    }
  });

  it("refuses whitespace and control characters", () => {
    for (const raw of [
      "lobby.example.com :8200",
      "lobby.exam ple.com:8200",
      "lobby.example.com:8200\nLOGIN x",
      "lobby.example.com\t:8200",
      "lobby.example.com\u0000:8200",
    ]) {
      expect(normaliseServerAddress(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("refuses a host written in anything but ASCII", () => {
    // A Cyrillic "е" in place of the Latin one, and a full-width dot.
    expect(normaliseServerAddress("lobby.еxample.com:8200")).toBeNull();
    expect(normaliseServerAddress("lobby．example.com:8200")).toBeNull();
  });

  it("keeps a punycode host in its xn-- form, which cannot pass for another", () => {
    expect(normaliseServerAddress("xn--xample-2of.com:8200")?.host).toBe(
      "xn--xample-2of.com",
    );
  });

  it("refuses empty labels and labels that start or end with a hyphen", () => {
    expect(normaliseServerAddress("lobby..example.com:8200")).toBeNull();
    expect(normaliseServerAddress(".example.com:8200")).toBeNull();
    expect(normaliseServerAddress("-lobby.example.com:8200")).toBeNull();
    expect(normaliseServerAddress("lobby-.example.com:8200")).toBeNull();
    expect(normaliseServerAddress(":8200")).toBeNull();
  });

  it("refuses a host or a label longer than a name can be", () => {
    expect(normaliseServerAddress(`${"a".repeat(64)}.com:8200`)).toBeNull();
    const long = Array.from({ length: 64 }, () => "abc").join(".");
    expect(normaliseServerAddress(`${long}:8200`)).toBeNull();
  });

  it("writes every spelling of an IPv4 address the same way", () => {
    for (const raw of [
      "127.0.0.1:8200",
      "2130706433:8200",
      "0x7f.0.0.1:8200",
      "127.1:8200",
    ]) {
      expect(normaliseServerAddress(raw)?.address, raw).toBe("127.0.0.1:8200");
    }
  });

  it("reads an IPv6 address in brackets and writes it one way", () => {
    expect(normaliseServerAddress("[::1]:8200")?.address).toBe("[::1]:8200");
    expect(normaliseServerAddress("[0:0:0:0:0:0:0:1]:8200")?.address).toBe(
      "[::1]:8200",
    );
    expect(normaliseServerAddress("[2001:DB8::1]:8200")?.address).toBe(
      "[2001:db8::1]:8200",
    );
  });

  it("refuses an IPv6 address with no brackets, whose port cannot be told apart", () => {
    expect(normaliseServerAddress("::1:8200")).toBeNull();
    expect(normaliseServerAddress("[::1]")).toBeNull();
    expect(normaliseServerAddress("[::1:8200")).toBeNull();
    expect(normaliseServerAddress("[lobby.example.com]:8200")).toBeNull();
  });
});

describe("normaliseHostPort", () => {
  it("writes a saved server the way a link's address is written", () => {
    expect(normaliseHostPort("Lobby.Example.com.", 8200)?.address).toBe(
      "lobby.example.com:8200",
    );
  });

  it("takes a saved IPv6 host with or without brackets", () => {
    expect(normaliseHostPort("::1", 8200)?.address).toBe("[::1]:8200");
    expect(normaliseHostPort("[::1]", 8200)?.address).toBe("[::1]:8200");
  });

  it("answers nothing for a saved host that is not one, so it matches no link", () => {
    expect(normaliseHostPort("", 8200)).toBeNull();
    expect(normaliseHostPort("a b", 8200)).toBeNull();
    expect(normaliseHostPort("lobby.example.com", 0)).toBeNull();
    expect(normaliseHostPort("lobby.example.com", 8200.5)).toBeNull();
  });
});
