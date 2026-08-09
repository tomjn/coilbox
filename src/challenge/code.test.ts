import { describe, expect, it } from "vitest";
import { encodeContainerCode, identify } from "../container/container";
import { decodeChallenge, encodeChallenge, encodeChallengeFile } from "./code";

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

  it("names the game at the top of the payload, from the mode's settings", () => {
    const code = encodeChallenge("conquest", {
      seed: 1,
      name: "x",
      game: { shortname: "BA", pinnedName: "BA V12.1" },
    });
    expect(identify(code).game).toEqual({ name: "BA V12.1", shortname: "BA" });
  });

  it("reads the game out of a challenge shared before the shared field", () => {
    const legacy = encodeContainerCode("challenge", 1, {
      mode: "conquest",
      settings: { seed: 1, name: "x", game: { shortname: "BA" } },
    });
    expect(identify(legacy).game).toEqual({ shortname: "BA" });
    expect(decodeChallenge(legacy, "conquest", parseSettings)).toEqual({
      ok: true,
      settings: { seed: 1, name: "x" },
    });
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

  it("rejects a future legacy format version", () => {
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

  it("decodes a legacy pre-container challenge code", () => {
    // A code shared before the #479 container: the old envelope, base64url.
    const raw = JSON.stringify({
      format: "coilbox-challenge",
      formatVersion: 1,
      kind: "conquest",
      settings: { seed: 7, name: "Legacy Reach" },
    });
    const code = btoa(unescape(encodeURIComponent(raw)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const result = decodeChallenge(code, "conquest", parseSettings);
    expect(result).toEqual({
      ok: true,
      settings: { seed: 7, name: "Legacy Reach" },
    });
  });

  it("round-trips settings through a file export's JSON text (issue #476)", () => {
    const settings: Settings = { seed: 42, name: "Crimson Reach" };
    const fileText = encodeChallengeFile("conquest", settings);
    const result = decodeChallenge(fileText, "conquest", parseSettings);
    expect(result).toEqual({ ok: true, settings });
  });

  it("writes a file export as readable JSON, not a base64url code", () => {
    const fileText = encodeChallengeFile("conquest", { seed: 1, name: "x" });
    expect(() => JSON.parse(fileText)).not.toThrow();
    expect(JSON.parse(fileText)).toMatchObject({
      format: "coilbox",
      kind: "challenge",
    });
  });

  it("rejects a malformed file export", () => {
    const result = decodeChallenge(
      "{ not valid json",
      "conquest",
      parseSettings,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a file export for the wrong kind", () => {
    const fileText = encodeChallengeFile("conquest", { seed: 1, name: "x" });
    const result = decodeChallenge(fileText, "warpath", parseSettings);
    expect(result).toEqual({ ok: false, error: "wrong-kind" });
  });

  it("rejects a container with a newer kind version", () => {
    const raw = JSON.stringify({
      format: "coilbox",
      container: 1,
      kind: "challenge",
      kindVersion: 99,
      payload: { mode: "conquest", settings: { seed: 1, name: "x" } },
    });
    const code = btoa(unescape(encodeURIComponent(raw)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const result = decodeChallenge(code, "conquest", parseSettings);
    expect(result).toEqual({ ok: false, error: "unsupported-version" });
  });
});
