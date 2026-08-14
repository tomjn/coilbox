import { describe, expect, it } from "vitest";
import type { Battle } from "../multiplayer/bindings";
import type { DirectLanRoom } from "./bindings";
import {
  addressProblem,
  joinBlockedReason,
  joinRoomFailure,
  otherRooms,
  ownRoomHeard,
  roomBattle,
  splitHostPort,
} from "./lan";

const heard = (id: string, isSelf: boolean) =>
  ({ id, title: `room ${id}`, isSelf }) as unknown as DirectLanRoom;

describe("otherRooms", () => {
  // The host is already in their own room, and the battle list below holds it
  // with the way back into it, so listing it here as well was the same room
  // twice (issue #1608).
  it("leaves out the room this client is hosting", () => {
    const rooms = otherRooms([heard("mine", true), heard("theirs", false)]);
    expect(rooms.map((room) => room.id)).toEqual(["theirs"]);
  });

  it("keeps every room somebody else is announcing", () => {
    const rooms = [heard("a", false), heard("b", false)];
    expect(otherRooms(rooms)).toEqual(rooms);
  });
});

describe("ownRoomHeard", () => {
  it("is true once this client's own beacon comes back", () => {
    expect(ownRoomHeard([heard("theirs", false), heard("mine", true)])).toBe(
      true,
    );
  });

  it("is false while nothing of ours has been heard", () => {
    expect(ownRoomHeard([heard("theirs", false)])).toBe(false);
    expect(ownRoomHeard([])).toBe(false);
  });
});

describe("splitHostPort", () => {
  // What a host reads out, and what they copy off their own screen, is one
  // string with both halves in it.
  it("moves a pasted port into the port field", () => {
    expect(splitHostPort("192.168.1.5:8200")).toEqual({
      address: "192.168.1.5",
      port: "8200",
    });
  });

  it("leaves a bare address alone", () => {
    expect(splitHostPort("192.168.1.5")).toEqual({
      address: "192.168.1.5",
      port: null,
    });
  });

  it("takes a hostname the same way", () => {
    expect(splitHostPort("tomlaptop.local:8300")).toEqual({
      address: "tomlaptop.local",
      port: "8300",
    });
  });

  it("trims what was pasted, since a copied address brings its edges", () => {
    expect(splitHostPort("  192.168.1.5:8200 ")).toEqual({
      address: "192.168.1.5",
      port: "8200",
    });
  });

  // `::1` is all colons and nothing here can tell its last group from a port.
  it("does not try to split an IPv6 address", () => {
    expect(splitHostPort("fe80::1")).toEqual({
      address: "fe80::1",
      port: null,
    });
  });

  it("does not treat a trailing word as a port", () => {
    expect(splitHostPort("tomlaptop:lobby")).toEqual({
      address: "tomlaptop:lobby",
      port: null,
    });
  });
});

describe("addressProblem", () => {
  it("takes an address and a name, because either can be dialled", () => {
    expect(addressProblem("192.168.1.5")).toBeNull();
    expect(addressProblem("tomlaptop.local")).toBeNull();
  });

  it("asks for an address rather than dialling nothing", () => {
    expect(addressProblem("  ")).toBe("Enter the host's address.");
  });

  it("refuses a URL, which is the thing people paste by mistake", () => {
    expect(addressProblem("http://192.168.1.5:8200")).toContain(
      "no http:// and no path",
    );
  });

  it("refuses an address with a space in it", () => {
    expect(addressProblem("192.168.1.5 8200")).toBe(
      "An address has no spaces in it.",
    );
  });
});

describe("joinBlockedReason", () => {
  it("lets a client with no connection join", () => {
    expect(joinBlockedReason(null, false)).toBeNull();
  });

  // Coilbox holds one lobby connection, so whatever has it, a join needs it.
  it("says to stop your own room first", () => {
    expect(joinBlockedReason("Tom@127.0.0.1:8200", true)).toContain(
      "Stop your own room first",
    );
  });

  // Said of the connection rather than the battle, because leaving the battle
  // leaves the connection to the room behind it, and a join still cannot have it.
  it("says to disconnect from a room already connected to", () => {
    expect(joinBlockedReason("Tom@127.0.0.1:8200", false)).toContain(
      "connected to a room already",
    );
  });

  it("says to log out of a server", () => {
    expect(
      joinBlockedReason("Tom@lobby.beyondallreason.info:8200", false),
    ).toContain("Log out of the lobby server first");
  });

  // Hosting is checked before the key, because a host's own client is connected
  // to their room and "leave the room you are in" is not what they should do.
  it("prefers the room over the connection it made", () => {
    expect(joinBlockedReason("Tom@127.0.0.1:8200", true)).toContain(
      "your own room",
    );
  });
});

describe("joinRoomFailure", () => {
  it("names the address when nothing is listening on it", () => {
    const message = joinRoomFailure(
      new Error("Connection refused (os error 61)"),
      "192.168.1.5",
      8200,
    );
    expect(message).toContain("192.168.1.5:8200");
    expect(message).toContain("Nothing is hosting");
  });

  it("blames the network when nothing answered at all", () => {
    expect(
      joinRoomFailure(new Error("operation timed out"), "192.168.1.5", 8200),
    ).toContain("different network");
    expect(
      joinRoomFailure(new Error("No route to host"), "10.0.0.9", 8200),
    ).toContain("different network");
  });

  it("blames the name when the name is the thing that failed", () => {
    expect(
      joinRoomFailure(
        new Error(
          "failed to lookup address information: nodename nor servname provided",
        ),
        "tomlaptop",
        8200,
      ),
    ).toContain("No machine called tomlaptop");
  });

  it("passes anything else through rather than guessing", () => {
    expect(joinRoomFailure(new Error("DENIED name taken"), "x", 1)).toBe(
      "DENIED name taken",
    );
  });

  it("still says something when the failure carried no words", () => {
    expect(joinRoomFailure(null, "192.168.1.5", 8200)).toBe(
      "Could not join 192.168.1.5:8200.",
    );
  });
});

describe("roomBattle", () => {
  const battle = (id: number) => ({ id }) as unknown as Battle;

  it("answers with the battle as soon as there is one, without waiting", async () => {
    const waits: number[] = [];
    const found = await roomBattle(
      async () => [battle(1)],
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(found?.id).toBe(1);
    expect(waits).toEqual([]);
  });

  // The gap this exists for: the login is accepted and the battle it opens has
  // not arrived yet, so a join sent now would have no id to name.
  it("keeps looking while the room has told us of no battle", async () => {
    let looks = 0;
    const found = await roomBattle(
      async () => {
        looks += 1;
        return looks < 3 ? [] : [battle(7)];
      },
      async () => {},
    );
    expect(found?.id).toBe(7);
    expect(looks).toBe(3);
  });

  it("gives up rather than waiting on a battle that never comes", async () => {
    let waits = 0;
    const found = await roomBattle(
      async () => [],
      async () => {
        waits += 1;
      },
    );
    expect(found).toBeNull();
    expect(waits).toBe(50);
  });
});
