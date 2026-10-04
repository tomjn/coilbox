import { describe, expect, it } from "vitest";
import {
  MAX_CODE_LENGTH,
  MAX_FIELD_LENGTH,
  openScreenRoute,
  parseDeepLink,
} from "./parse";

describe("parseDeepLink", () => {
  describe("rejects malformed input", () => {
    it("rejects an empty string", () => {
      expect(parseDeepLink("")).toEqual({
        kind: "invalid",
        reason: expect.any(String),
      });
    });

    it("rejects a non-coilbox scheme", () => {
      const r = parseDeepLink("https://example.com/join?battle=1");
      expect(r.kind).toBe("invalid");
    });

    it("rejects total garbage", () => {
      expect(parseDeepLink("not a url at all").kind).toBe("invalid");
    });

    it("rejects an unknown action", () => {
      const r = parseDeepLink("coilbox://frobnicate?x=1");
      expect(r).toMatchObject({ kind: "invalid" });
    });
  });

  // A room on somebody's own machine (issue #1612), which is the address and
  // port a host would otherwise be reading out over voice chat.
  describe("room", () => {
    it("parses an address and a port", () => {
      expect(
        parseDeepLink("coilbox://room?address=192.168.1.45&port=8200"),
      ).toEqual({ kind: "room", address: "192.168.1.45", port: 8200 });
    });

    it("takes a hostname, because a room can be behind one", () => {
      expect(
        parseDeepLink("coilbox://room?address=tom-laptop.local&port=8200"),
      ).toMatchObject({ address: "tom-laptop.local" });
    });

    it("rejects a link with no address", () => {
      expect(parseDeepLink("coilbox://room?port=8200").kind).toBe("invalid");
    });

    // Guessing 8200 would send somebody to a room that is not there, and the
    // host who pasted the link would never know why nobody arrived.
    it("rejects a link with no port rather than assuming the usual one", () => {
      expect(parseDeepLink("coilbox://room?address=192.168.1.45").kind).toBe(
        "invalid",
      );
    });

    it("rejects a port no socket could be listening on", () => {
      expect(
        parseDeepLink("coilbox://room?address=192.168.1.45&port=99999").kind,
      ).toBe("invalid");
      expect(
        parseDeepLink("coilbox://room?address=192.168.1.45&port=0").kind,
      ).toBe("invalid");
      expect(
        parseDeepLink("coilbox://room?address=192.168.1.45&port=eight").kind,
      ).toBe("invalid");
    });

    it("rejects an address with a path on it", () => {
      expect(
        parseDeepLink("coilbox://room?address=evil.com%2Fpath&port=8200").kind,
      ).toBe("invalid");
    });
  });

  describe("join", () => {
    const join = (query: string) => parseDeepLink(`coilbox://join?${query}`);
    const server = encodeURIComponent("lobby.example.com:8200");

    it("parses a valid join link", () => {
      expect(join(`server=${server}&battle=42`)).toEqual({
        kind: "join",
        server: "lobby.example.com:8200",
        battle: "42",
      });
    });

    it("carries an optional password", () => {
      expect(join(`server=${server}&battle=42&password=secret`)).toEqual({
        kind: "join",
        server: "lobby.example.com:8200",
        battle: "42",
        password: "secret",
      });
    });

    it("rejects a join with no server", () => {
      expect(parseDeepLink("coilbox://join?battle=42").kind).toBe("invalid");
    });

    it("rejects a join with no battle", () => {
      expect(join(`server=${server}`).kind).toBe("invalid");
    });

    // The link is written by whoever sent it (issue #3382). Everything below
    // is a link that must be refused here, before anything is offered.
    describe("a hostile link", () => {
      it("hands back the server in the one form it is compared and shown in", () => {
        expect(
          join(
            `server=${encodeURIComponent("Lobby.EXAMPLE.com.:08200")}&battle=42`,
          ),
        ).toMatchObject({ server: "lobby.example.com:8200" });
      });

      it("rejects a server with no port rather than assuming one", () => {
        expect(join("server=lobby.example.com&battle=42").kind).toBe("invalid");
      });

      it("rejects a server that names two hosts", () => {
        for (const raw of [
          "lobby.example.com@evil.example:8200",
          "evil.example:8200/lobby.example.com",
          "lobby.example.com:8200#evil.example",
          "lobby.еxample.com:8200",
          "lobby.example.com:8200 evil.example:8200",
        ]) {
          expect(
            join(`server=${encodeURIComponent(raw)}&battle=42`).kind,
            raw,
          ).toBe("invalid");
        }
      });

      it("reads the first server when a link repeats the field", () => {
        expect(
          join(
            `server=${server}&server=${encodeURIComponent("evil.example:8200")}&battle=42`,
          ),
        ).toMatchObject({ server: "lobby.example.com:8200" });
      });

      it("takes a battle that is a number and nothing else", () => {
        for (const raw of [
          "42 1",
          "42\nLOGIN x",
          "4a",
          "-1",
          "4.2",
          "0x10",
          "1e3",
          "<b>42</b>",
          // One past what the join command's battle id holds.
          "4294967296",
          "99999999999",
        ]) {
          expect(
            join(`server=${server}&battle=${encodeURIComponent(raw)}`).kind,
            JSON.stringify(raw),
          ).toBe("invalid");
        }
      });

      it("writes a battle number one way", () => {
        expect(join(`server=${server}&battle=0042`)).toMatchObject({
          battle: "42",
        });
        expect(join(`server=${server}&battle=4294967295`)).toMatchObject({
          battle: "4294967295",
        });
      });

      it("rejects a password that could not be one word of a lobby command", () => {
        for (const raw of [
          "two words",
          "line\nLOGIN x",
          "line\rbreak",
          "tab\there",
          "nul\u0000",
          "pässword",
          "x".repeat(MAX_FIELD_LENGTH + 1),
        ]) {
          expect(
            join(
              `server=${server}&battle=42&password=${encodeURIComponent(raw)}`,
            ).kind,
            JSON.stringify(raw.slice(0, 20)),
          ).toBe("invalid");
        }
      });

      it("does not trim a password into a valid one", () => {
        expect(
          join(`server=${server}&battle=42&password=%20secret%20`).kind,
        ).toBe("invalid");
      });

      it("reads an empty password as none", () => {
        expect(join(`server=${server}&battle=42&password=`)).toEqual({
          kind: "join",
          server: "lobby.example.com:8200",
          battle: "42",
        });
      });

      it("carries nothing a link adds beyond the three fields", () => {
        expect(
          join(`server=${server}&battle=42&tls=0&account=bob&name=Official`),
        ).toEqual({
          kind: "join",
          server: "lobby.example.com:8200",
          battle: "42",
        });
      });
    });
  });

  describe("import", () => {
    it("parses an inline code", () => {
      expect(parseDeepLink("coilbox://import?code=abc123")).toEqual({
        kind: "import",
        source: { type: "code", code: "abc123" },
      });
    });

    it("parses an https fetch url", () => {
      const r = parseDeepLink(
        "coilbox://import?url=https%3A%2F%2Fexample.com%2Fp.json",
      );
      expect(r).toEqual({
        kind: "import",
        source: { type: "url", url: "https://example.com/p.json" },
      });
    });

    it("rejects a non-https fetch url", () => {
      const r = parseDeepLink(
        "coilbox://import?url=http%3A%2F%2Fexample.com%2Fp.json",
      );
      expect(r.kind).toBe("invalid");
    });

    it("rejects both a code and a url", () => {
      const r = parseDeepLink("coilbox://import?code=a&url=https://x.test/p");
      expect(r.kind).toBe("invalid");
    });

    it("rejects an import with no payload", () => {
      expect(parseDeepLink("coilbox://import").kind).toBe("invalid");
    });

    it("rejects an oversized code", () => {
      const big = "a".repeat(MAX_CODE_LENGTH + 1);
      const r = parseDeepLink(`coilbox://import?code=${big}`);
      expect(r.kind).toBe("invalid");
    });
  });

  describe("open", () => {
    it("parses a screen that needs an id", () => {
      expect(
        parseDeepLink("coilbox://open?screen=map&id=Comet%20Catcher"),
      ).toEqual({ kind: "open", screen: "map", id: "Comet Catcher" });
    });

    it("parses a screen that needs no id", () => {
      expect(parseDeepLink("coilbox://open?screen=conquest")).toEqual({
        kind: "open",
        screen: "conquest",
      });
    });

    it("rejects a screen that needs an id but has none", () => {
      expect(parseDeepLink("coilbox://open?screen=map").kind).toBe("invalid");
    });

    it("rejects an unknown screen", () => {
      expect(parseDeepLink("coilbox://open?screen=settings").kind).toBe(
        "invalid",
      );
    });

    it("rejects an open with no screen", () => {
      expect(parseDeepLink("coilbox://open").kind).toBe("invalid");
    });
  });
});

describe("openScreenRoute", () => {
  it("fills the id for an id-bearing screen", () => {
    expect(openScreenRoute({ screen: "replay", id: "game 1" })).toBe(
      "/play/replays/game%201",
    );
  });

  it("returns the static route for an idless screen", () => {
    expect(openScreenRoute({ screen: "battles" })).toBe("/battles");
  });
});
