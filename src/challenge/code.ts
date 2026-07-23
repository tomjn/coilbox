/**
 * Shared codec for challenge codes — the compact, pasteable text that carries a
 * conquest galaxy's or warpath run's seed + generation settings so a second
 * player can recreate the identical galaxy/run locally (issue #376). Zero
 * infrastructure: the code is just base64url(JSON), small enough to paste into
 * Discord or any chat client.
 *
 * The envelope (`format`/`formatVersion`/`kind`) is shared by both conquest and
 * warpath codes; each feature owns its own `settings` shape and validator (see
 * `../conquest/challenge.ts` and `../runlite/challenge.ts`). Versioned like the
 * campaign/preset export wrappers, so a future format change can be detected
 * and rejected cleanly instead of silently misinterpreted.
 */

export const CHALLENGE_FORMAT = "coilbox-challenge";
export const CHALLENGE_FORMAT_VERSION = 1;

interface ChallengeEnvelope<K extends string, S> {
  format: typeof CHALLENGE_FORMAT;
  formatVersion: typeof CHALLENGE_FORMAT_VERSION;
  kind: K;
  settings: S;
}

/** Encode a UTF-8 string as base64url (no padding), safely round-tripping any
 * JSON (unicode names, etc.), unlike a bare `btoa`. */
function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decode a base64url string back to UTF-8 text. Throws on invalid input. */
function base64UrlDecode(code: string): string {
  const padded = code.replace(/-/g, "+").replace(/_/g, "/");
  const pad =
    padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Encode a challenge's settings into a pasteable code. */
export function encodeChallenge<K extends string, S>(
  kind: K,
  settings: S,
): string {
  const envelope: ChallengeEnvelope<K, S> = {
    format: CHALLENGE_FORMAT,
    formatVersion: CHALLENGE_FORMAT_VERSION,
    kind,
    settings,
  };
  return base64UrlEncode(JSON.stringify(envelope));
}

/** Why a pasted code was rejected — surfaced as a friendly inline message. */
export type ChallengeDecodeError =
  | "malformed"
  | "unknown-format"
  | "unsupported-version"
  | "wrong-kind";

export type ChallengeDecodeResult<S> =
  | { ok: true; settings: S }
  | { ok: false; error: ChallengeDecodeError };

/**
 * Decode and validate a pasted challenge code for a specific `kind` (a
 * conquest code pasted where a warpath code is expected is rejected as
 * `wrong-kind`, not silently misread). Never throws: malformed, truncated or
 * corrupted input always resolves to a typed error.
 */
export function decodeChallenge<K extends string, S>(
  code: string,
  kind: K,
  parseSettings: (value: unknown) => S | null,
): ChallengeDecodeResult<S> {
  let json: string;
  try {
    json = base64UrlDecode(code.trim());
  } catch {
    return { ok: false, error: "malformed" };
  }
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: "malformed" };
  }
  if (typeof data !== "object" || data === null) {
    return { ok: false, error: "malformed" };
  }
  const d = data as Record<string, unknown>;
  if (d.format !== CHALLENGE_FORMAT)
    return { ok: false, error: "unknown-format" };
  if (d.formatVersion !== CHALLENGE_FORMAT_VERSION) {
    return { ok: false, error: "unsupported-version" };
  }
  if (d.kind !== kind) return { ok: false, error: "wrong-kind" };
  const settings = parseSettings(d.settings);
  if (!settings) return { ok: false, error: "malformed" };
  return { ok: true, settings };
}

/** A human-readable message for a decode error, for inline error banners. */
export function challengeDecodeErrorMessage(
  error: ChallengeDecodeError,
): string {
  switch (error) {
    case "unknown-format":
      return "That doesn't look like a coilbox challenge code.";
    case "unsupported-version":
      return "This challenge code was made by a newer version of coilbox.";
    case "wrong-kind":
      return "That challenge code is for a different game mode.";
    default:
      return "That challenge code is corrupted or incomplete.";
  }
}
