import { describe, expect, it } from "vitest";
import { encodeContainerCode } from "../container/container";
import { buildDeepLink, buildImportCodeLink, buildJoinLink } from "./build";
import {
  MAX_CODE_LENGTH,
  MAX_FIELD_LENGTH,
  MAX_URL_LENGTH,
  parseDeepLink,
} from "./parse";

describe("buildDeepLink", () => {
  describe("join", () => {
    it("round-trips a join link", () => {
      const action = {
        kind: "join" as const,
        server: "lobby.example.com:8200",
        battle: "42",
      };
      const built = buildDeepLink(action);
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(parseDeepLink(built.url)).toEqual(action);
    });

    it("round-trips a join link with a password", () => {
      const action = {
        kind: "join" as const,
        server: "h",
        battle: "42",
        password: "secret",
      };
      const built = buildDeepLink(action);
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(parseDeepLink(built.url)).toEqual(action);
    });

    it("rejects a join with no server", () => {
      const built = buildDeepLink({
        kind: "join",
        server: "",
        battle: "42",
      });
      expect(built).toEqual({ ok: false, reason: expect.any(String) });
    });

    it("rejects a join with no battle", () => {
      const built = buildDeepLink({ kind: "join", server: "h", battle: "" });
      expect(built.ok).toBe(false);
    });

    it("rejects an oversized field", () => {
      const built = buildDeepLink({
        kind: "join",
        server: "h".repeat(MAX_FIELD_LENGTH + 1),
        battle: "42",
      });
      expect(built.ok).toBe(false);
    });
  });

  describe("import", () => {
    it("round-trips an inline code", () => {
      const action = {
        kind: "import" as const,
        source: { type: "code" as const, code: "abc123" },
      };
      const built = buildDeepLink(action);
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(parseDeepLink(built.url)).toEqual(action);
    });

    it("round-trips a base64url code with padding-sensitive characters", () => {
      const code = "a-b_c-d_e-f_g-h_i-j_k-l_m-n_o-p_q-r_s-t_u-v";
      const built = buildDeepLink({
        kind: "import",
        source: { type: "code", code },
      });
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(parseDeepLink(built.url)).toEqual({
        kind: "import",
        source: { type: "code", code },
      });
    });

    it("carries a compressed code's prefix dot without percent-encoding it", () => {
      const code = encodeContainerCode("preset", 1, { hello: "world" });
      const built = buildDeepLink({
        kind: "import",
        source: { type: "code", code },
      });
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      // The marker dot survives the link verbatim (issue #557): a percent-encoded
      // one would bloat every code by two characters for no gain.
      expect(built.url).toContain(`code=${code}`);
      expect(parseDeepLink(built.url)).toEqual({
        kind: "import",
        source: { type: "code", code },
      });
    });

    it("round-trips an https fetch url", () => {
      const action = {
        kind: "import" as const,
        source: { type: "url" as const, url: "https://example.com/p.json" },
      };
      const built = buildDeepLink(action);
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(parseDeepLink(built.url)).toEqual(action);
    });

    it("rejects a non-https fetch url", () => {
      const built = buildDeepLink({
        kind: "import",
        source: { type: "url", url: "http://example.com/p.json" },
      });
      expect(built.ok).toBe(false);
    });

    it("rejects an empty code", () => {
      const built = buildDeepLink({
        kind: "import",
        source: { type: "code", code: "" },
      });
      expect(built.ok).toBe(false);
    });

    it("rejects an oversized code", () => {
      const built = buildDeepLink({
        kind: "import",
        source: { type: "code", code: "a".repeat(MAX_CODE_LENGTH + 1) },
      });
      expect(built.ok).toBe(false);
    });

    it("rejects an oversized url", () => {
      const built = buildDeepLink({
        kind: "import",
        source: {
          type: "url",
          url: `https://example.com/${"a".repeat(MAX_URL_LENGTH)}`,
        },
      });
      expect(built.ok).toBe(false);
    });
  });

  describe("open", () => {
    it("round-trips a screen that needs an id", () => {
      const action = {
        kind: "open" as const,
        screen: "map" as const,
        id: "Comet Catcher",
      };
      const built = buildDeepLink(action);
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(parseDeepLink(built.url)).toEqual(action);
    });

    it("round-trips a screen that needs no id", () => {
      const action = { kind: "open" as const, screen: "conquest" as const };
      const built = buildDeepLink(action);
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(parseDeepLink(built.url)).toEqual(action);
    });

    it("rejects a screen that needs an id but has none", () => {
      const built = buildDeepLink({ kind: "open", screen: "replay" });
      expect(built.ok).toBe(false);
    });
  });
});

describe("buildImportCodeLink", () => {
  it("builds an import link that parses back to the same code", () => {
    const link = buildImportCodeLink("abc123");
    expect(link).not.toBeNull();
    expect(parseDeepLink(link ?? "")).toEqual({
      kind: "import",
      source: { type: "code", code: "abc123" },
    });
  });

  it("returns null for an empty code rather than a broken link", () => {
    expect(buildImportCodeLink("")).toBeNull();
  });
});

describe("buildJoinLink", () => {
  it("builds a join link that parses back to the same server and battle", () => {
    const link = buildJoinLink("lobby.example.com:8200", "42");
    expect(link).not.toBeNull();
    expect(parseDeepLink(link ?? "")).toEqual({
      kind: "join",
      server: "lobby.example.com:8200",
      battle: "42",
    });
  });

  it("returns null when the server is missing", () => {
    expect(buildJoinLink(null, "42")).toBeNull();
    expect(buildJoinLink(undefined, "42")).toBeNull();
    expect(buildJoinLink("", "42")).toBeNull();
  });

  it("returns null when the battle id is missing", () => {
    expect(buildJoinLink("lobby.example.com", null)).toBeNull();
    expect(buildJoinLink("lobby.example.com", undefined)).toBeNull();
    expect(buildJoinLink("lobby.example.com", "")).toBeNull();
  });
});
