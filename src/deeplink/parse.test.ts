import { describe, expect, it } from "vitest";
import { MAX_CODE_LENGTH, openScreenRoute, parseDeepLink } from "./parse";

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

  describe("join", () => {
    it("parses a valid join link", () => {
      expect(
        parseDeepLink("coilbox://join?server=lobby.example.com&battle=42"),
      ).toEqual({
        kind: "join",
        server: "lobby.example.com",
        battle: "42",
      });
    });

    it("carries an optional password", () => {
      expect(
        parseDeepLink("coilbox://join?server=h&battle=42&password=secret"),
      ).toEqual({
        kind: "join",
        server: "h",
        battle: "42",
        password: "secret",
      });
    });

    it("rejects a join with no server", () => {
      expect(parseDeepLink("coilbox://join?battle=42").kind).toBe("invalid");
    });

    it("rejects a join with no battle", () => {
      expect(parseDeepLink("coilbox://join?server=h").kind).toBe("invalid");
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
