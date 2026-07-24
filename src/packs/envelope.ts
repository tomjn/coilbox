/**
 * The setup pack's codec (issue #415): a self-identifying envelope around a
 * `SetupPackManifest`, small enough to paste into chat and a natural payload for
 * a deep link (#388).
 *
 * As of issue #479 a pack rides in the canonical coilbox container
 * (`../container/container.ts`) with `kind: "setup-pack"`. Envelope concerns
 * (encode, decode, format/version/kind checks) stay in this one module, kept
 * separate from `manifest.ts`'s pack-specific shape validation. Packs shared
 * before the container (the legacy `coilbox-pack` envelope) still decode, so no
 * already-pasted pack code breaks.
 */

import {
  decodeContainerText,
  encodeContainerCode,
  readContainer,
} from "../container/container";

/** Payload schema version for a setup-pack container. */
export const PACK_KIND_VERSION = 1;

/** The pre-container envelope, still read for backward compatibility. */
const LEGACY_PACK_FORMAT = "coilbox-pack";
const LEGACY_PACK_FORMAT_VERSION = 1;
const LEGACY_PACK_KIND = "setup-pack";

/** Encode a pack's settings (its manifest) into a pasteable code. */
export function encodePackEnvelope<S>(settings: S): string {
  return encodeContainerCode("setup-pack", PACK_KIND_VERSION, settings);
}

/** Why a pasted pack code was rejected, surfaced as a friendly inline message. */
export type PackDecodeError =
  | "malformed"
  | "unknown-format"
  | "unsupported-version"
  | "wrong-kind";

export type PackDecodeResult<S> =
  | { ok: true; settings: S }
  | { ok: false; error: PackDecodeError };

/**
 * Decode and validate a pasted pack code. Never throws: malformed, truncated,
 * corrupted, or wrong-kind input (e.g. a challenge code pasted here) always
 * resolves to a typed error instead of a half-applied import. `parseSettings`
 * does the pack-shape validation (`manifest.ts`) and returns `null` for
 * anything invalid, including an empty map list.
 */
export function decodePackEnvelope<S>(
  code: string,
  parseSettings: (value: unknown) => S | null,
): PackDecodeResult<S> {
  const data = decodeContainerText(code);
  if (typeof data !== "object" || data === null) {
    return { ok: false, error: "malformed" };
  }

  // Canonical container (issue #479).
  const result = readContainer(data, "setup-pack", parseSettings);
  if (result.ok) return { ok: true, settings: result.payload };
  if (result.error !== "unknown-format") {
    return { ok: false, error: result.error };
  }

  // Legacy pre-container envelope, so packs shared before #479 still work.
  const d = data as Record<string, unknown>;
  if (d.format !== LEGACY_PACK_FORMAT) {
    return { ok: false, error: "unknown-format" };
  }
  if (d.formatVersion !== LEGACY_PACK_FORMAT_VERSION) {
    return { ok: false, error: "unsupported-version" };
  }
  if (d.kind !== LEGACY_PACK_KIND) return { ok: false, error: "wrong-kind" };
  const settings = parseSettings(d.settings);
  if (!settings) return { ok: false, error: "malformed" };
  return { ok: true, settings };
}

/** A human-readable message for a decode error, for inline error banners. */
export function packDecodeErrorMessage(error: PackDecodeError): string {
  switch (error) {
    case "unknown-format":
      return "That doesn't look like a coilbox setup pack.";
    case "unsupported-version":
      return "This setup pack was made by a newer version of coilbox.";
    case "wrong-kind":
      return "That code isn't a setup pack.";
    default:
      return "That setup pack is corrupted or incomplete.";
  }
}
