/**
 * Shared codec for challenge codes - the compact, pasteable text that carries a
 * conquest galaxy's or warpath run's seed + generation settings so a second
 * player can recreate the identical galaxy/run locally (issue #376). Zero
 * infrastructure: the code is just the container's compressed JSON (issue #557),
 * small enough to paste into Discord or any chat client.
 *
 * As of issue #479 a challenge rides in the canonical coilbox container
 * (`../container/container.ts`) with `kind: "challenge"`. The conquest/warpath
 * distinction lives in the payload's `mode`, so both game modes share one
 * envelope while each feature still owns its own `settings` shape and validator
 * (see `../conquest/challenge.ts` and `../runlite/challenge.ts`). Codes shared
 * before the container (the legacy `coilbox-challenge` envelope) still decode,
 * so no already-pasted code breaks.
 *
 * Issue #476 adds a file export alongside the pasteable code: the same
 * container, written as pretty-printed JSON to a `.json` file instead of
 * base64url text, for larger payloads or where pasting a long code is
 * awkward. `decodeChallenge` already reads either shape (see
 * `decodeContainerText`), so a file round-trips through the exact same decode
 * as a pasted code with no extra branch.
 */

import {
  asContainer,
  CONTAINER_VERSION,
  decodeContainerText,
  encodeContainerCode,
  encodeContainerJson,
} from "../container/container";
import {
  type GameIdentity,
  parseGameIdentity,
} from "../container/gameIdentity";

/** Payload schema version for a challenge container. */
export const CHALLENGE_KIND_VERSION = 1;

/** The pre-container envelope, still read for backward compatibility. */
const LEGACY_CHALLENGE_FORMAT = "coilbox-challenge";
const LEGACY_CHALLENGE_FORMAT_VERSION = 1;

/**
 * The container payload: the game mode, that mode's settings, and the game the
 * challenge targets.
 *
 * `game` repeats what `settings.game` already says. It is written anyway so
 * every container kind names its game in the same field in the same place
 * (issue #1335), rather than a reader having to know that a challenge buries it
 * one level down in a mode-specific settings shape. `settings.game` stays
 * because it is the generator's input, and it stays the only spelling an older
 * coilbox reads.
 */
interface ChallengePayload<S> {
  mode: string;
  settings: S;
  game?: GameIdentity;
}

/**
 * Build the payload for a challenge. Both modes hold a `GameRef` at
 * `settings.game`, so the shared identity is derived from it rather than passed
 * in separately, which keeps the two from ever disagreeing.
 */
function challengePayload<K extends string, S>(
  kind: K,
  settings: S,
): ChallengePayload<S> {
  const game = parseGameIdentity(
    (settings as { game?: unknown } | null)?.game ?? null,
  );
  return { mode: kind, settings, ...(game ? { game } : {}) };
}

/** Encode a challenge's settings into a pasteable code. */
export function encodeChallenge<K extends string, S>(
  kind: K,
  settings: S,
): string {
  return encodeContainerCode(
    "challenge",
    CHALLENGE_KIND_VERSION,
    challengePayload(kind, settings),
  );
}

/** Encode a challenge's settings as pretty-printed JSON text, for a `.json`
 * file export (issue #476) instead of a pasteable code. */
export function encodeChallengeFile<K extends string, S>(
  kind: K,
  settings: S,
): string {
  return encodeContainerJson(
    "challenge",
    CHALLENGE_KIND_VERSION,
    challengePayload(kind, settings),
  );
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
  const data = decodeContainerText(code);
  if (typeof data !== "object" || data === null) {
    return { ok: false, error: "malformed" };
  }

  // Canonical container (issue #479): kind "challenge", mode in the payload.
  const container = asContainer(data);
  if (container) {
    if (container.container > CONTAINER_VERSION) {
      return { ok: false, error: "unsupported-version" };
    }
    if (container.kind !== "challenge") {
      return { ok: false, error: "unknown-format" };
    }
    if (container.kindVersion > CHALLENGE_KIND_VERSION) {
      return { ok: false, error: "unsupported-version" };
    }
    const payload = container.payload as Record<string, unknown> | null;
    if (typeof payload !== "object" || payload === null) {
      return { ok: false, error: "malformed" };
    }
    if (payload.mode !== kind) return { ok: false, error: "wrong-kind" };
    const settings = parseSettings(payload.settings);
    if (!settings) return { ok: false, error: "malformed" };
    return { ok: true, settings };
  }

  // Legacy pre-container envelope, so codes shared before #479 still work.
  const d = data as Record<string, unknown>;
  if (d.format !== LEGACY_CHALLENGE_FORMAT) {
    return { ok: false, error: "unknown-format" };
  }
  if (d.formatVersion !== LEGACY_CHALLENGE_FORMAT_VERSION) {
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
