import { describe, expect, it } from "vitest";
import { inviteLink } from "./invite";

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

  it("gives nothing for a room reached over loopback", () => {
    expect(inviteLink("127.0.0.1:8200", true, "1")).toBeNull();
  });

  it("gives nothing for a room address with no port in it", () => {
    expect(inviteLink("192.168.1.45", true, "1")).toBeNull();
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
