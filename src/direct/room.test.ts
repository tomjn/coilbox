import { describe, expect, it } from "vitest";
import type { Battle } from "../multiplayer/bindings";
import type { DirectRoomStatus } from "./bindings";
import {
  battleOpened,
  DEFAULT_ROOM_PORT,
  directServer,
  isDirectKey,
  newPendingNames,
  pendingJoinsHeadline,
  playerNameProblem,
  roomPasswordProblem,
  roomPortProblem,
  roomStopReason,
  roomSummary,
  startButtonLabel,
  startRoomFailure,
  waitingJoinNotice,
} from "./room";

describe("directServer", () => {
  it("dials loopback in the clear, because the socket never leaves the machine", () => {
    const server = directServer(8200);
    expect(server.host).toBe("127.0.0.1");
    expect(server.port).toBe(8200);
    expect(server.tls).toBe(false);
    expect(server.protocol).toBe("tasserver");
  });

  it("produces a key the store recognises as a room", () => {
    // The store keys a connection `username@host:port` (see `serverKeyFor`).
    const server = directServer(8200);
    expect(isDirectKey(`Tom@${server.host}:${server.port}`)).toBe(true);
  });

  it("dials somebody else's room where their beacon came from", () => {
    const server = directServer(8300, "192.168.1.5");
    expect(server.host).toBe("192.168.1.5");
    expect(server.port).toBe(8300);
    expect(server.tls).toBe(false);
    expect(server.name).toContain("192.168.1.5");
  });
});

describe("isDirectKey", () => {
  it("does not mistake a real server for a room", () => {
    expect(isDirectKey("Tom@lobby.beyondallreason.info:8200")).toBe(false);
  });

  it("reads no connection as no room", () => {
    expect(isDirectKey(null)).toBe(false);
  });
});

describe("startRoomFailure", () => {
  // The wording differs per platform, and a host meets this failure more than any
  // other, so both families have to reach the same sentence.
  it("names the port and what to do about it on unix", () => {
    const message = startRoomFailure(
      new Error(
        "cannot listen on port 8200: Address already in use (os error 48)",
      ),
      8200,
    );
    expect(message).toContain("Port 8200 is already in use");
    expect(message).toContain("Pick another port");
  });

  it("recognises the same failure in Windows's words", () => {
    const message = startRoomFailure(
      "cannot listen on port 8200: Only one usage of each socket address is normally permitted. (os error 10048)",
      8200,
    );
    expect(message).toContain("Port 8200 is already in use");
  });

  it("passes anything else through rather than guessing", () => {
    expect(startRoomFailure(new Error("permission denied"), 80)).toBe(
      "permission denied",
    );
  });

  it("still says something when the failure carried no words", () => {
    expect(startRoomFailure(null, 8200)).toBe(
      "Could not start a room on port 8200.",
    );
  });
});

describe("roomStopReason", () => {
  it("names the host, so the drop is not anonymous", () => {
    expect(roomStopReason("Tom")).toBe("Tom closed this room");
  });

  it("falls back to a reason rather than an empty message", () => {
    expect(roomStopReason("  ")).toBe("the host closed this room");
  });
});

describe("startButtonLabel", () => {
  it("says a press landed, so nobody presses twice", () => {
    expect(startButtonLabel(true, true)).toBe("Starting…");
  });

  it("says what it is waiting on before the hashes land", () => {
    expect(startButtonLabel(false, false)).toBe("Reading content…");
  });

  it("offers the start once there is something to start", () => {
    expect(startButtonLabel(false, true)).toBe("Start room");
  });
});

describe("roomSummary", () => {
  const room = (over: Partial<DirectRoomStatus> = {}): DirectRoomStatus => ({
    port: 8200,
    host: "Tom",
    ip: "127.0.0.1",
    approveJoins: false,
    advertise: true,
    peers: 1,
    pending: [],
    battle: null,
    ...over,
  });
  const battle = (passworded: boolean) => ({ passworded }) as unknown as Battle;

  it("counts the host out of the peers, since one of them is their own client", () => {
    expect(roomSummary(room({ peers: 1 }))).toContain("nobody has joined yet");
    expect(roomSummary(room({ peers: 2 }))).toContain("1 player joined");
    expect(roomSummary(room({ peers: 4 }))).toContain("3 players joined");
  });

  it("says where the room is and whose name holds it", () => {
    expect(roomSummary(room({ port: 8452, host: "Ada" }))).toContain(
      "Hosting on port 8452 as Ada",
    );
  });

  it("says whether a joiner needs the password", () => {
    expect(roomSummary(room({ battle: battle(true) }))).toContain(
      "password needed",
    );
    expect(roomSummary(room({ battle: battle(false) }))).toContain(
      "no password",
    );
  });

  // Between binding the port and opening the battle there is nothing to read the
  // answer off, and "no password" would be wrong for every passworded room.
  it("says nothing about a password before there is a battle to ask", () => {
    const line = roomSummary(room());
    expect(line).not.toContain("password");
    expect(line).toBe("Hosting on port 8200 as Tom, nobody has joined yet");
  });

  // A room's own count never goes below its host, but it is read off another
  // process and a line reading "-1 players joined" would be worse than a stale one.
  it("does not go negative if the room answers before the host is counted", () => {
    expect(roomSummary(room({ peers: 0 }))).toContain("nobody has joined yet");
  });
});

describe("pendingJoinsHeadline", () => {
  it("says one person without a number, because the buttons name them", () => {
    expect(pendingJoinsHeadline(1)).toBe("Somebody is waiting to join");
  });

  it("counts a queue, so a host knows to keep reading past the first", () => {
    expect(pendingJoinsHeadline(3)).toBe("3 people are waiting to join");
  });
});

describe("newPendingNames", () => {
  it("names only who has just started waiting", () => {
    expect(newPendingNames(["bob"], ["bob", "carol"])).toEqual(["carol"]);
  });

  // The list is republished every two seconds. Notifying off the list rather
  // than off the arrivals would be a toast every two seconds for as long as
  // anybody waits.
  it("says nothing about a queue that has not changed", () => {
    expect(newPendingNames(["bob", "carol"], ["bob", "carol"])).toEqual([]);
  });

  it("says nothing when a queue empties", () => {
    expect(newPendingNames(["bob"], [])).toEqual([]);
  });

  it("notices somebody who left the queue and came back", () => {
    expect(newPendingNames([], ["bob"])).toEqual(["bob"]);
  });
});

describe("waitingJoinNotice", () => {
  it("names the one person a host has to decide about", () => {
    expect(waitingJoinNotice(["bob"])).toEqual({
      title: "Somebody is waiting to join",
      body: "bob is waiting for you to let them into your room. Open the battle room to answer.",
    });
  });

  it("puts a whole tick's arrivals in one notification", () => {
    expect(waitingJoinNotice(["bob", "carol"])).toEqual({
      title: "2 people are waiting to join",
      body: "bob and carol are waiting for you to let them into your room. Open the battle room to answer.",
    });
  });
});

describe("roomPortProblem", () => {
  it("accepts the default", () => {
    expect(roomPortProblem(String(DEFAULT_ROOM_PORT))).toBeNull();
  });

  it("accepts any other real port", () => {
    expect(roomPortProblem("8452")).toBeNull();
    expect(roomPortProblem("65535")).toBeNull();
  });

  // Clamping this to 65535 is what put a host on a port they never chose, while
  // reading the one they typed out to a joiner.
  it("refuses a port above the range rather than correcting it", () => {
    expect(roomPortProblem("82008300")).toBe("Ports run from 1 to 65535.");
  });

  it("refuses port 0, which a host could not pass on to a joiner", () => {
    expect(roomPortProblem("0")).toBe("Ports run from 1 to 65535.");
  });

  it("asks for a port rather than guessing at an empty field", () => {
    expect(roomPortProblem("  ")).toBe("Enter a port.");
  });

  it("refuses anything that is not digits", () => {
    expect(roomPortProblem("82e3")).toBe("Ports are whole numbers.");
    expect(roomPortProblem("-1")).toBe("Ports are whole numbers.");
  });
});

describe("battleOpened", () => {
  const room = (over: Partial<DirectRoomStatus> = {}): DirectRoomStatus => ({
    port: 8200,
    host: "Tom",
    ip: "127.0.0.1",
    approveJoins: false,
    advertise: true,
    peers: 1,
    pending: [],
    battle: null,
    ...over,
  });
  const withBattle = room({ battle: {} as unknown as Battle });

  it("answers with the room as soon as it has the battle, without waiting", async () => {
    const waits: number[] = [];
    const opened = await battleOpened(
      async () => withBattle,
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(opened).toBe(withBattle);
    expect(waits).toEqual([]);
  });

  it("keeps looking while the room has only the host's socket", async () => {
    let looks = 0;
    const opened = await battleOpened(
      async () => {
        looks += 1;
        return looks < 3 ? room() : withBattle;
      },
      async () => {},
    );
    expect(opened).toBe(withBattle);
    expect(looks).toBe(3);
  });

  // The failure this exists for: the port is bound, the host's own client is on
  // it, and no battle is ever going to appear. Giving up is what lets the caller
  // stop the room and say so, rather than leaving it up in silence.
  it("gives up rather than waiting on a battle that never comes", async () => {
    let waits = 0;
    const opened = await battleOpened(
      async () => room(),
      async () => {
        waits += 1;
      },
    );
    expect(opened).toBeNull();
    expect(waits).toBe(50);
  });

  it("gives up on a room that has stopped underneath it", async () => {
    const opened = await battleOpened(
      async () => null,
      async () => {},
    );
    expect(opened).toBeNull();
  });
});

describe("playerNameProblem", () => {
  it("takes an ordinary name", () => {
    expect(playerNameProblem("Tom")).toBeNull();
    // Trimmed before it is sent, so the edges are not the player's problem.
    expect(playerNameProblem("  Tom  ")).toBeNull();
  });

  it("asks for a name rather than logging in as nobody", () => {
    expect(playerNameProblem("  ")).toBe("Enter the name others will see.");
  });

  // Sent, this one arrives as two fields and the room refuses the login with
  // nothing on screen to say why.
  it("refuses a name with a space in it", () => {
    expect(playerNameProblem("Tom J")).toContain("No spaces in your name");
  });
});

describe("roomPasswordProblem", () => {
  it("takes an ordinary password, and no password at all", () => {
    expect(roomPasswordProblem("s3cret")).toBeNull();
    expect(roomPasswordProblem("")).toBeNull();
    // Trimmed before it is sent, so the edges are not the host's problem.
    expect(roomPasswordProblem("  s3cret  ")).toBeNull();
  });

  // Sent, this one moves the port, the player limit and both content hashes
  // along a slot, and the battle that opens has a limit of zero: full to every
  // joiner, with nothing said to the host.
  it("refuses a password with a space in it", () => {
    expect(roomPasswordProblem("let me in")).toContain("No spaces");
    expect(roomPasswordProblem("let\tme in")).toContain("No spaces");
  });
});
