import { describe, expect, it } from "vitest";
import { decodeChallenge, encodeChallenge } from "./code";

interface Settings {
  seed: number;
  name: string;
}

function parseSettings(value: unknown): Settings | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.seed !== "number" || typeof v.name !== "string") return null;
  return { seed: v.seed, name: v.name };
}

describe("challenge code", () => {
  it("round-trips settings through encode/decode", () => {
    const settings: Settings = { seed: 42, name: "Crimson Reach" };
    const code = encodeChallenge("conquest", settings);
    const result = decodeChallenge(code, "conquest", parseSettings);
    expect(result).toEqual({ ok: true, settings });
  });

  it("round-trips unicode text", () => {
    const settings: Settings = { seed: 1, name: "ÉtoileÑo 星" };
    const code = encodeChallenge("warpath", settings);
    const result = decodeChallenge(code, "warpath", parseSettings);
    expect(result).toEqual({ ok: true, settings });
  });

  it("produces a URL-safe code with no padding", () => {
    const code = encodeChallenge("conquest", { seed: 1, name: "x" });
    expect(code).not.toMatch(/[+/=]/);
  });

  it("rejects a code for the wrong kind", () => {
    const code = encodeChallenge("conquest", { seed: 1, name: "x" });
    const result = decodeChallenge(code, "warpath", parseSettings);
    expect(result).toEqual({ ok: false, error: "wrong-kind" });
  });

  it("rejects settings that fail the validator", () => {
    const code = encodeChallenge("conquest", { seed: "not-a-number" });
    const result = decodeChallenge(code, "conquest", parseSettings);
    expect(result).toEqual({ ok: false, error: "malformed" });
  });

  it("rejects non-base64 garbage", () => {
    const result = decodeChallenge(
      "not a valid code!!!",
      "conquest",
      parseSettings,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a truncated code", () => {
    const code = encodeChallenge("conquest", { seed: 1, name: "truncate-me" });
    const truncated = code.slice(0, Math.floor(code.length / 2));
    const result = decodeChallenge(truncated, "conquest", parseSettings);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty string", () => {
    const result = decodeChallenge("", "conquest", parseSettings);
    expect(result.ok).toBe(false);
  });

  it("rejects a plain JSON payload with no envelope", () => {
    const code = btoa(JSON.stringify({ seed: 1, name: "x" }));
    const result = decodeChallenge(code, "conquest", parseSettings);
    expect(result).toEqual({ ok: false, error: "unknown-format" });
  });

  it("rejects a future format version", () => {
    const raw = JSON.stringify({
      format: "coilbox-challenge",
      formatVersion: 2,
      kind: "conquest",
      settings: { seed: 1, name: "x" },
    });
    const code = btoa(unescape(encodeURIComponent(raw)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const result = decodeChallenge(code, "conquest", parseSettings);
    expect(result).toEqual({ ok: false, error: "unsupported-version" });
  });
});
