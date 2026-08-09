import { describe, expect, it } from "vitest";
import {
  buildTachyonRequest,
  consoleView,
  MAX_FRAME_CHARS,
  parseTachyonEntry,
} from "./tachyonConsole";

describe("buildTachyonRequest", () => {
  it("turns a command id and a data object into what the command takes", () => {
    const built = buildTachyonRequest(
      "lobby/join",
      '{ "id": "75bfc493-2b9d-495d-a453-06722fdca2ea" }',
    );

    expect(built).toEqual({
      ok: true,
      request: {
        commandId: "lobby/join",
        data: { id: "75bfc493-2b9d-495d-a453-06722fdca2ea" },
      },
    });
  });

  it("sends no data at all when the data box is empty", () => {
    // 17 of the 68 requests in the schema have no data property, so an empty box
    // has to mean none rather than an empty object.
    expect(buildTachyonRequest("lobby/list", "")).toEqual({
      ok: true,
      request: { commandId: "lobby/list", data: null },
    });
    expect(buildTachyonRequest("lobby/list", "  \n ")).toEqual({
      ok: true,
      request: { commandId: "lobby/list", data: null },
    });
  });

  it("trims the command id", () => {
    const built = buildTachyonRequest("  party/create  ", "");

    expect(built).toEqual({
      ok: true,
      request: { commandId: "party/create", data: null },
    });
  });

  it("refuses data that is not JSON, before anything is sent", () => {
    const built = buildTachyonRequest("lobby/join", "{ id: nope }");

    expect(built.ok).toBe(false);
    if (built.ok) throw new Error("expected a refusal");
    expect(built.error).toMatch(/^Data is not JSON: /);
  });

  it("refuses JSON that is not an object", () => {
    // Every data in the schema is an object. Teiserver answers anything else
    // with invalid_request at best, so it is refused here instead.
    for (const text of ["[1, 2]", '"a string"', "42", "null"]) {
      const built = buildTachyonRequest("lobby/join", text);
      expect(built).toEqual({
        ok: false,
        error: "Data has to be a JSON object.",
      });
    }
  });

  it("refuses an empty command id", () => {
    expect(buildTachyonRequest("   ", '{ "id": "a" }')).toEqual({
      ok: false,
      error: "Enter a command id.",
    });
  });
});

describe("consoleView", () => {
  it("keeps the wire log a TASServer connection has always shown", () => {
    expect(consoleView("tasserver")).toBe("lines");
  });

  it("shows frames on a Tachyon connection", () => {
    expect(consoleView("tachyon")).toBe("frames");
  });
});

/** A console line the way `mirrorReducer` stores it. */
function received(frame: unknown): string {
  return `<< ${JSON.stringify(frame)}`;
}

function sent(frame: unknown): string {
  return `>> ${JSON.stringify(frame)}`;
}

describe("parseTachyonEntry", () => {
  it("lays a frame out over several lines", () => {
    const entry = parseTachyonEntry(
      received({
        type: "event",
        messageId: "7",
        commandId: "user/updated",
        data: { users: [{ userId: "2" }] },
      }),
    );

    expect(entry.json).toBe(true);
    expect(entry.body).toBe(
      [
        "{",
        '  "type": "event",',
        '  "messageId": "7",',
        '  "commandId": "user/updated",',
        '  "data": {',
        '    "users": [',
        "      {",
        '        "userId": "2"',
        "      }",
        "    ]",
        "  }",
        "}",
      ].join("\n"),
    );
    expect(entry.truncated).toBe(false);
  });

  it("pulls out the three fields a reader scans for", () => {
    const entry = parseTachyonEntry(
      received({
        type: "response",
        messageId: "e0f1c2",
        commandId: "lobby/join",
        status: "success",
        data: { id: "75bfc493" },
      }),
    );

    expect(entry.type).toBe("response");
    expect(entry.commandId).toBe("lobby/join");
    expect(entry.status).toBe("success");
    expect(entry.reason).toBeNull();
    expect(entry.details).toBeNull();
  });

  it("pulls out the reason and details of a failed response", () => {
    const entry = parseTachyonEntry(
      received({
        type: "response",
        messageId: "e0f1c2",
        commandId: "lobby/join",
        status: "failed",
        reason: "lobby_full",
        details: "the lobby has 16 of 16 players",
      }),
    );

    expect(entry.status).toBe("failed");
    expect(entry.reason).toBe("lobby_full");
    expect(entry.details).toBe("the lobby has 16 of 16 players");
  });

  it("reads the direction off the prefix the console log adds", () => {
    expect(parseTachyonEntry(sent({ type: "request" })).direction).toBe("out");
    expect(parseTachyonEntry(received({ type: "event" })).direction).toBe("in");
  });

  it("shows a line that is not JSON as it stands rather than throwing", () => {
    // What the connection task writes for a TASServer line it cannot carry.
    const entry = parseTachyonEntry(
      ">> not sent, this server speaks Tachyon: JOIN #main",
    );

    expect(entry.json).toBe(false);
    expect(entry.direction).toBe("out");
    expect(entry.body).toBe("not sent, this server speaks Tachyon: JOIN #main");
    expect(entry.type).toBeNull();
    expect(entry.commandId).toBeNull();
  });

  it("does not throw on a frame the server cut in half", () => {
    const entry = parseTachyonEntry('<< {"type":"event","commandId":"user/upd');

    expect(entry.json).toBe(false);
    expect(entry.body).toBe('{"type":"event","commandId":"user/upd');
  });

  it("does not throw on an empty line", () => {
    const entry = parseTachyonEntry("");

    expect(entry.json).toBe(false);
    expect(entry.body).toBe("");
    expect(entry.direction).toBe("in");
  });

  it("shows a frame that is JSON but not an object, with no envelope", () => {
    const entry = parseTachyonEntry("<< 42");

    expect(entry.json).toBe(true);
    expect(entry.body).toBe("42");
    expect(entry.type).toBeNull();
  });

  it("ignores an envelope field that is not a string", () => {
    // A server that sends the wrong type must not put an object where the row
    // expects a word.
    const entry = parseTachyonEntry(
      received({ type: "response", commandId: { nested: true }, status: 7 }),
    );

    expect(entry.type).toBe("response");
    expect(entry.commandId).toBeNull();
    expect(entry.status).toBeNull();
  });

  it("cuts a very long frame short and says so", () => {
    // A lobby list on a busy server. Laid out over several lines this is far
    // past the cap, so the drawer gets the start of it and a note.
    const lobbies = Array.from({ length: 2000 }, (_, i) => ({
      id: `lobby-${i}`,
      name: `A lobby with a name of its own, number ${i}`,
    }));
    const entry = parseTachyonEntry(
      received({
        type: "response",
        commandId: "lobby/list",
        status: "success",
        data: { lobbies },
      }),
    );

    expect(entry.truncated).toBe(true);
    expect(entry.body).toHaveLength(MAX_FRAME_CHARS);
    // Still readable from the top, which is where the envelope is.
    expect(entry.body.startsWith('{\n  "type": "response",')).toBe(true);
    expect(entry.commandId).toBe("lobby/list");
  });

  it("leaves a frame that fits alone", () => {
    const entry = parseTachyonEntry(received({ type: "event", data: {} }));

    expect(entry.truncated).toBe(false);
    expect(entry.body.length).toBeLessThan(MAX_FRAME_CHARS);
  });
});
