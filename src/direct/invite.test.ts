import { describe, expect, it } from "vitest";
import { parseDeepLink } from "@/deeplink/parse";
import { inviteLink, inviteLinkProblem } from "./invite";

describe("inviteLink", () => {
  it("gives a room's address as a room link, not a join link", () => {
    expect(inviteLink("192.168.1.45:8200", true, "1")).toBe(
      "coilbox://room?address=192.168.1.45&port=8200",
    );
  });

  it("carries the port the room was dialled on", () => {
    expect(inviteLink("192.168.1.45:8300", true, "1")).toBe(
      "coilbox://room?address=192.168.1.45&port=8300",
    );
  });

  // Issue #3409. A joiner passes on the address they dialled, spelled however
  // they typed it, and the link has to come back through the parser as that room.
  it("gives a link the parser reads back as the room dialled, for every spelling a joiner can type", () => {
    for (const [dialled, address, port] of [
      ["192.168.1.45:8200", "192.168.1.45", 8200],
      ["tomlaptop.local:8200", "tomlaptop.local", 8200],
      ["TomLaptop.LOCAL:8300", "tomlaptop.local", 8300],
      ["example.com.:8200", "example.com", 8200],
      ["0x7f.1:8200", "127.0.0.1", 8200],
    ] as const) {
      const link = inviteLink(dialled, true, "1");
      expect(link, dialled).not.toBeNull();
      expect(parseDeepLink(link ?? ""), dialled).toEqual({
        kind: "room",
        address,
        port,
      });
    }
  });

  // Issue #3420. A joiner at an IPv6 room passes on the address they dialled, in
  // brackets with its port, and it comes back through the parser as that room.
  it("gives a room link for an IPv6 room", () => {
    for (const [dialled, address] of [
      ["[2001:db8::1]:8200", "[2001:db8::1]"],
      ["[2001:0db8:0:0:0:0:0:1]:8200", "[2001:db8::1]"],
      ["[::ffff:1.2.3.4]:8200", "[::ffff:102:304]"],
    ] as const) {
      const link = inviteLink(dialled, true, "1");
      expect(link, dialled).not.toBeNull();
      expect(parseDeepLink(link ?? ""), dialled).toEqual({
        kind: "room",
        address,
        port: 8200,
      });
    }
  });

  it("gives nothing for a room reached over IPv6 loopback", () => {
    expect(inviteLink("[::1]:8200", true, "1")).toBeNull();
  });

  it("gives nothing for a room address a link could not carry", () => {
    expect(inviteLink("known@evil.example:8200", true, "1")).toBeNull();
    expect(inviteLink("my_pc.local:8200", true, "1")).toBeNull();
  });

  it("gives nothing for a room reached over loopback", () => {
    expect(inviteLink("127.0.0.1:8200", true, "1")).toBeNull();
  });

  it("gives nothing for a room address with no port in it", () => {
    expect(inviteLink("192.168.1.45", true, "1")).toBeNull();
  });

  it("says why a zone id has no link, and says nothing for any other address", () => {
    expect(inviteLinkProblem("[fe80::1%eth0]:8200")).toMatch(/network card/);
    expect(inviteLinkProblem("[2001:db8::1]:8200")).toBeNull();
    expect(inviteLinkProblem("lobby.example.com:8200")).toBeNull();
    expect(inviteLinkProblem(null)).toBeNull();
  });

  it("gives nothing when there is no connection to name", () => {
    expect(inviteLink(null, true, "1")).toBeNull();
    expect(inviteLink(undefined, false, "1")).toBeNull();
    expect(inviteLink("", false, "1")).toBeNull();
  });

  it("still gives a server's battle as a join link", () => {
    expect(inviteLink("lobby.beyondallreason.info:8200", false, "42")).toBe(
      "coilbox://join?server=lobby.beyondallreason.info%3A8200&battle=42",
    );
  });

  it("gives nothing for a server battle with no id", () => {
    expect(inviteLink("lobby.beyondallreason.info:8200", false, "")).toBeNull();
  });
});
