import { describe, expect, it } from "vitest";
import {
  decodePackEnvelope,
  encodePackEnvelope,
  packDecodeErrorMessage,
} from "./envelope";

interface Payload {
  n: number;
}

const parse = (v: unknown): Payload | null => {
  if (typeof v !== "object" || v === null) return null;
  const n = (v as Record<string, unknown>).n;
  return typeof n === "number" ? { n } : null;
};

describe("envelope", () => {
  it("round-trips a payload", () => {
    const code = encodePackEnvelope<Payload>({ n: 42 });
    const result = decodePackEnvelope(code, parse);
    expect(result).toEqual({ ok: true, settings: { n: 42 } });
  });

  it("rejects garbage as malformed", () => {
    expect(decodePackEnvelope("not-base64url!!!", parse)).toEqual({
      ok: false,
      error: "malformed",
    });
  });

  it("rejects valid base64url that isn't JSON", () => {
    const notJson = btoa("hello world");
    expect(decodePackEnvelope(notJson, parse)).toEqual({
      ok: false,
      error: "malformed",
    });
  });

  it("rejects a different format", () => {
    const code = btoa(
      JSON.stringify({
        format: "some-other-format",
        formatVersion: 1,
        kind: "setup-pack",
        settings: { n: 1 },
      }),
    );
    expect(decodePackEnvelope(code, parse)).toEqual({
      ok: false,
      error: "unknown-format",
    });
  });

  it("rejects a newer format version", () => {
    const code = btoa(
      JSON.stringify({
        format: "coilbox-pack",
        formatVersion: 99,
        kind: "setup-pack",
        settings: { n: 1 },
      }),
    );
    expect(decodePackEnvelope(code, parse)).toEqual({
      ok: false,
      error: "unsupported-version",
    });
  });

  it("rejects the wrong kind", () => {
    const code = btoa(
      JSON.stringify({
        format: "coilbox-pack",
        formatVersion: 1,
        kind: "coilbox-challenge",
        settings: { n: 1 },
      }),
    );
    expect(decodePackEnvelope(code, parse)).toEqual({
      ok: false,
      error: "wrong-kind",
    });
  });

  it("rejects a settings shape the caller's parser refuses", () => {
    const code = encodePackEnvelope({ wrong: true });
    expect(decodePackEnvelope(code, parse)).toEqual({
      ok: false,
      error: "malformed",
    });
  });

  it("gives every error a distinct human message", () => {
    const messages = new Set(
      (
        [
          "malformed",
          "unknown-format",
          "unsupported-version",
          "wrong-kind",
        ] as const
      ).map(packDecodeErrorMessage),
    );
    expect(messages.size).toBe(4);
  });
});
