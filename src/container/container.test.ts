import { describe, expect, it } from "vitest";
import {
  asContainer,
  base64UrlDecode,
  base64UrlEncode,
  COMPRESSED_CODE_PREFIX,
  CONTAINER_FORMAT,
  CONTAINER_VERSION,
  decodeContainerText,
  encodeContainerCode,
  encodeContainerJson,
  identify,
  makeContainer,
  readContainer,
  sniffPayloadKind,
  tryEncodeContainerCode,
} from "./container";

describe("container envelope", () => {
  it("round-trips a payload through JSON encode and decode", () => {
    const json = encodeContainerJson("preset", 1, { hello: "world" });
    const value = decodeContainerText(json);
    const container = asContainer(value);
    expect(container).not.toBeNull();
    expect(container?.kind).toBe("preset");
    expect(container?.payload).toEqual({ hello: "world" });
  });

  it("round-trips a payload through a base64url code", () => {
    const code = encodeContainerCode("challenge", 1, { mode: "conquest" });
    expect(code).not.toMatch(/[+/=]/);
    const value = decodeContainerText(code);
    expect(asContainer(value)?.payload).toEqual({ mode: "conquest" });
  });

  it("emits a compressed code marked with the compression prefix", () => {
    const code = encodeContainerCode("preset", 1, { hello: "world" });
    expect(code.startsWith(COMPRESSED_CODE_PREFIX)).toBe(true);
    // URL-safe throughout: base64url alphabet plus the single marker dot.
    expect(code).toMatch(/^cbz1\.[A-Za-z0-9_-]+$/);
  });

  it("makes a long code much shorter than plain base64url", () => {
    // A restriction list is the realistic worst case (issue #557).
    const payload = {
      disabledUnits: Array.from({ length: 173 }, (_, i) => `corunit${i}`),
    };
    const compressed = encodeContainerCode("preset", 1, payload);
    const plain = base64UrlEncode(
      JSON.stringify(makeContainer("preset", 1, payload)),
    );
    expect(compressed.length).toBeLessThan(plain.length / 2);
    expect(decodeContainerText(compressed)).toEqual(
      makeContainer("preset", 1, payload),
    );
  });

  it("round-trips unicode through a compressed code", () => {
    const payload = { name: "ÉtoileÑo 星" };
    const value = decodeContainerText(
      encodeContainerCode("campaign", 1, payload),
    );
    expect(asContainer(value)?.payload).toEqual(payload);
  });

  it("still reads a plain base64url code shared before compression", () => {
    const legacy = base64UrlEncode(
      JSON.stringify(makeContainer("setup-pack", 1, { maps: ["a"] })),
    );
    expect(asContainer(decodeContainerText(legacy))?.kind).toBe("setup-pack");
  });

  it("refuses to encode a code larger than the decode side can inflate", () => {
    // Random bytes, because that is what an already-compressed portrait or
    // voice clip looks like to DEFLATE. A compressible payload of the same
    // length would inflate back under the ceiling and is allowed.
    const bytes = new Uint8Array(600 * 1024);
    for (let i = 0; i < bytes.length; i += 65536) {
      crypto.getRandomValues(
        bytes.subarray(i, Math.min(i + 65536, bytes.length)),
      );
    }
    const result = tryEncodeContainerCode("scenario", 1, {
      blob: Buffer.from(bytes).toString("base64"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.limit).toBe(512 * 1024);
    expect(result.bytes).toBeGreaterThan(result.limit);
  });

  it("encodes a payload that fits, and it round-trips", () => {
    const result = tryEncodeContainerCode("scenario", 1, { hello: "world" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toBe(
      encodeContainerCode("scenario", 1, { hello: "world" }),
    );
    expect(asContainer(decodeContainerText(result.code))?.payload).toEqual({
      hello: "world",
    });
  });

  it("measures the ceiling in UTF-8 bytes, not characters", () => {
    // Each of these is three bytes and one character, so a payload that fits by
    // character count can still be over the ceiling the inflate buffer enforces.
    const payload = { text: "星".repeat(200 * 1024) };
    expect(JSON.stringify(payload).length).toBeLessThan(512 * 1024);
    const result = tryEncodeContainerCode("scenario", 1, payload);
    expect(result.ok).toBe(false);
  });

  it("reports a corrupted compressed code as unreadable, never throws", () => {
    expect(
      decodeContainerText(`${COMPRESSED_CODE_PREFIX}not-real-deflate`),
    ).toBe(null);
    const code = encodeContainerCode("preset", 1, { hello: "world" });
    expect(decodeContainerText(code.slice(0, code.length - 6))).toBe(null);
    expect(decodeContainerText(COMPRESSED_CODE_PREFIX)).toBe(null);
  });

  it("round-trips unicode through base64url", () => {
    const text = "ÉtoileÑo 星";
    expect(base64UrlDecode(base64UrlEncode(text))).toBe(text);
  });

  it("carries the top-level coilbox marker", () => {
    const c = makeContainer("campaign", 1, {});
    expect(c.format).toBe(CONTAINER_FORMAT);
    expect(c.container).toBe(CONTAINER_VERSION);
  });
});

describe("identify", () => {
  it("identifies each canonical kind", () => {
    for (const kind of [
      "campaign",
      "preset",
      "challenge",
      "setup-pack",
    ] as const) {
      const json = encodeContainerJson(kind, 1, {});
      const id = identify(json);
      expect(id.kind).toBe(kind);
      expect(id.version).toBe(1);
      expect(id.compatibility).toBe("ok");
      expect(id.warnings).toEqual([]);
    }
  });

  it("identifies a payload passed as a base64url code", () => {
    const code = encodeContainerCode("setup-pack", 1, {});
    expect(identify(code).kind).toBe("setup-pack");
  });

  it("identifies a compressed code and reports a corrupted one as unknown", () => {
    expect(identify(encodeContainerCode("challenge", 1, {})).kind).toBe(
      "challenge",
    );
    expect(identify(`${COMPRESSED_CODE_PREFIX}garbage`).kind).toBe("unknown");
  });

  it("identifies an already-parsed object", () => {
    const id = identify(makeContainer("preset", 1, {}));
    expect(id.kind).toBe("preset");
  });

  it("flags a newer container version", () => {
    const id = identify({
      format: "coilbox",
      container: 99,
      kind: "campaign",
      kindVersion: 1,
      payload: {},
    });
    expect(id.compatibility).toBe("newer");
    expect(id.warnings[0]).toMatch(/newer version of coilbox/);
  });

  it("flags a newer kind schema version", () => {
    const id = identify(encodeContainerJson("preset", 99, {}));
    expect(id.compatibility).toBe("newer");
    expect(id.warnings[0]).toMatch(/newer version of coilbox/);
  });

  it("flags an unknown kind from a coilbox container as newer", () => {
    const id = identify({
      format: "coilbox",
      container: 1,
      kind: "quantum-warp",
      kindVersion: 3,
      payload: {},
    });
    expect(id.kind).toBe("unknown");
    expect(id.compatibility).toBe("newer");
  });

  it("warns when the declared kind and payload shape disagree", () => {
    // A container labelled a campaign but carrying a preset-shaped payload.
    const id = identify(
      makeContainer("campaign", 1, {
        participants: [],
        gameName: "BAR",
        mapName: "Comet Catcher",
      }),
    );
    expect(id.kind).toBe("campaign");
    expect(id.warnings.some((w) => w.includes("preset"))).toBe(true);
  });

  it("reports unrelated JSON as unknown, never misapplied", () => {
    const id = identify(JSON.stringify({ some: "other", tool: 1 }));
    expect(id).toEqual({
      kind: "unknown",
      version: 0,
      compatibility: "unknown",
      warnings: [],
    });
  });

  it("reports non-JSON garbage as unknown", () => {
    expect(identify("not a valid payload!!!").kind).toBe("unknown");
    expect(identify("").kind).toBe("unknown");
  });

  it("identifies legacy shapes without an envelope rewrite", () => {
    expect(
      identify(JSON.stringify({ format: "coilbox-campaign", formatVersion: 1 }))
        .kind,
    ).toBe("campaign");
    expect(
      identify(JSON.stringify({ format: "coilbox-pack", formatVersion: 1 }))
        .kind,
    ).toBe("setup-pack");
    expect(
      identify(
        JSON.stringify({
          format: "coilbox-challenge",
          formatVersion: 1,
          kind: "warpath",
        }),
      ).kind,
    ).toBe("challenge");
    // A legacy bare preset carries no envelope, recognised by shape.
    expect(
      identify(
        JSON.stringify({
          participants: [],
          gameName: "BAR",
          mapName: "Comet",
        }),
      ).kind,
    ).toBe("preset");
  });

  it("flags a legacy shape with a future formatVersion as newer", () => {
    const id = identify(
      JSON.stringify({ format: "coilbox-campaign", formatVersion: 5 }),
    );
    expect(id.kind).toBe("campaign");
    expect(id.compatibility).toBe("newer");
  });
});

describe("readContainer", () => {
  const parse = (v: unknown) =>
    typeof v === "object" && v !== null ? (v as { ok: true }) : null;

  it("reads a matching kind's payload", () => {
    const value = decodeContainerText(
      encodeContainerJson("preset", 1, { ok: true }),
    );
    const result = readContainer(value, "preset", parse);
    expect(result).toEqual({ ok: true, payload: { ok: true } });
  });

  it("rejects a wrong kind", () => {
    const value = decodeContainerText(encodeContainerJson("campaign", 1, {}));
    expect(readContainer(value, "preset", parse)).toEqual({
      ok: false,
      error: "wrong-kind",
    });
  });

  it("rejects a newer kind version", () => {
    const value = decodeContainerText(encodeContainerJson("preset", 99, {}));
    expect(readContainer(value, "preset", parse)).toEqual({
      ok: false,
      error: "unsupported-version",
    });
  });

  it("reports a non-container as unknown-format so a legacy fallback can try", () => {
    expect(readContainer({ foo: 1 }, "preset", parse)).toEqual({
      ok: false,
      error: "unknown-format",
    });
  });

  it("rejects a payload the validator refuses", () => {
    const value = decodeContainerText(encodeContainerJson("preset", 1, "nope"));
    expect(readContainer(value, "preset", parse)).toEqual({
      ok: false,
      error: "malformed",
    });
  });
});

describe("sniffPayloadKind", () => {
  it("recognises each kind by shape", () => {
    expect(sniffPayloadKind({ type: "ta", missions: [] })).toBe("campaign");
    expect(
      sniffPayloadKind({
        engineVersion: "1",
        maps: ["a"],
        game: { name: "x" },
      }),
    ).toBe("setup-pack");
    // engineVersion is optional (issue #1334): a pack pinning no engine still
    // sniffs correctly from its other fields.
    expect(
      sniffPayloadKind({
        maps: ["a"],
        game: { name: "x" },
      }),
    ).toBe("setup-pack");
    expect(sniffPayloadKind({ mode: "warpath", settings: {} })).toBe(
      "challenge",
    );
    expect(
      sniffPayloadKind({ participants: [], gameName: "x", mapName: "y" }),
    ).toBe("preset");
    expect(
      sniffPayloadKind({ scenario: { triggers: [], zones: [] }, media: {} }),
    ).toBe("scenario");
    expect(sniffPayloadKind({ random: true })).toBeNull();
  });
});
