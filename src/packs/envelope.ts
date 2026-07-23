/**
 * The setup pack's container format (issue #415): a versioned, self-identifying
 * envelope around a `SetupPackManifest`, encoded as base64url(JSON). Same
 * approach as challenge codes (`../challenge/code.ts`, issue #376), so a pack
 * travels the same way: small enough to paste into chat, and a natural payload
 * for a future deep link (#388).
 *
 * All envelope concerns (encode, decode, format/version/kind checks) live in
 * this one module and nowhere else, kept separate from `manifest.ts`'s
 * pack-specific shape validation. Issue #479 plans a shared "Coilbox JSON
 * container format" across every export the app produces (campaigns, presets,
 * challenge codes, packs). Keeping this isolated means that work can replace
 * this wrapper later without touching pack semantics.
 */

export const PACK_FORMAT = "coilbox-pack";
export const PACK_FORMAT_VERSION = 1;
/** Explicit, unambiguous type discriminator for this envelope's payload. */
export const PACK_KIND = "setup-pack";

interface PackEnvelope<S> {
  format: typeof PACK_FORMAT;
  formatVersion: typeof PACK_FORMAT_VERSION;
  kind: typeof PACK_KIND;
  settings: S;
}

/** Encode a UTF-8 string as base64url (no padding). Safely round-trips any
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

/** Encode a pack's settings (its manifest) into a pasteable code. */
export function encodePackEnvelope<S>(settings: S): string {
  const envelope: PackEnvelope<S> = {
    format: PACK_FORMAT,
    formatVersion: PACK_FORMAT_VERSION,
    kind: PACK_KIND,
    settings,
  };
  return base64UrlEncode(JSON.stringify(envelope));
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
  if (d.format !== PACK_FORMAT) return { ok: false, error: "unknown-format" };
  if (d.formatVersion !== PACK_FORMAT_VERSION) {
    return { ok: false, error: "unsupported-version" };
  }
  if (d.kind !== PACK_KIND) return { ok: false, error: "wrong-kind" };
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
