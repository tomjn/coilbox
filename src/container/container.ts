/**
 * The one canonical, self-identifying Coilbox JSON container (issue #479).
 *
 * Every JSON artefact coilbox shares (campaigns, presets, challenge codes,
 * setup packs) wraps its payload in this envelope, so opening any file or
 * pasting any code tells you immediately what it holds and which schema version
 * produced it, without guessing from the payload shape. The same envelope is
 * used for BOTH raw `.json` files AND pasteable codes, so one decode and
 * identify path serves both. A code is
 * `"cbz1." + base64url(deflate(JSON.stringify(envelope)))`; codes shared before
 * issue #557 were uncompressed base64url and still decode.
 *
 * Compatibility ("this comes from a newer version of coilbox") is derived from
 * two integers, not the app's semver. The app version is a deliberately poor
 * signal here because dev builds always report `0.0.0` (see CLAUDE.md: the real
 * version is injected from the git tag only at release), so a build-time semver
 * would flag every dev-made file as ancient. Instead:
 *
 * - `container` is the envelope format version. Bump it when this wrapper's own
 *   shape changes.
 * - `kindVersion` is the payload schema version, independent per kind. Bump it
 *   when a specific payload's shape changes.
 *
 * A payload whose `container` or `kindVersion` is higher than this build
 * supports is "newer", which is exactly the signal the issue asks for.
 *
 * Every payload that targets a game names it the same way (issue #1335): a
 * `game` field at the top of the payload holding a {@link GameIdentity}, which
 * carries the full archive name and the modinfo shortname side by side. See
 * `./gameIdentity.ts`. Adding that field is additive, so no `kindVersion` moves
 * for it: an older build ignores a field it has never heard of and reads the
 * payload exactly as before, and bumping would lock those builds out of files
 * they can honour (the same reasoning `../campaign/transfer.ts` gives for not
 * always writing `kindVersion: 2`). Every kind therefore keeps writing its old
 * spelling alongside, and {@link identify} reports the identity for payloads
 * written either way.
 *
 * Issue #388 (deep links) calls {@link identify} to validate an incoming payload
 * before applying it.
 */

import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import { type GameIdentity, gameIdentityFromPayload } from "./gameIdentity";

/** Top-level marker present on every coilbox container. */
export const CONTAINER_FORMAT = "coilbox";

/** Envelope format version this build writes and understands. */
export const CONTAINER_VERSION = 1;

/** The unambiguous payload discriminator. */
export type ContainerKind =
  | "campaign"
  | "preset"
  | "challenge"
  | "setup-pack"
  | "scenario";

export const CONTAINER_KINDS: readonly ContainerKind[] = [
  "campaign",
  "preset",
  "challenge",
  "setup-pack",
  "scenario",
];

/**
 * Highest payload schema version this build understands, per kind. A container
 * whose `kindVersion` exceeds its kind's entry here is from a newer coilbox and
 * is reported as `newer` rather than silently misread.
 */
export const SUPPORTED_KIND_VERSIONS: Record<ContainerKind, number> = {
  campaign: 2,
  preset: 1,
  challenge: 1,
  "setup-pack": 1,
  scenario: 1,
};

export interface Container<P = unknown> {
  format: typeof CONTAINER_FORMAT;
  container: typeof CONTAINER_VERSION;
  kind: ContainerKind;
  kindVersion: number;
  payload: P;
}

/**
 * Marks a code whose JSON is raw-DEFLATE compressed (issue #557). A setup pack
 * carrying a unit restriction list ran to 4,000+ characters, past the ~2,000
 * character URL limit plenty of software enforces, so codes are compressed
 * before base64url.
 *
 * The dot is deliberate: it is outside the base64url alphabet, so an
 * uncompressed code shared before #557 can never be mistaken for a compressed
 * one. It also needs no percent-encoding in a `coilbox://import?code=` link.
 */
export const COMPRESSED_CODE_PREFIX = "cbz1.";

/**
 * Largest JSON we will inflate from a code. A code arrives from outside the app
 * and DEFLATE reaches roughly 1000:1, so an unbounded inflate turns a small
 * link into a huge allocation. `fflate` fills a fixed `out` buffer and
 * truncates rather than growing, which turns that into a failed `JSON.parse`
 * and a "corrupted" message. Matches `MAX_IMPORT_BYTES` in
 * `../deeplink/fetchImport.ts`, the same ceiling a fetched import gets.
 */
const MAX_INFLATED_BYTES = 512 * 1024;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(code: string): Uint8Array {
  const padded = code.replace(/-/g, "+").replace(/_/g, "/");
  const pad =
    padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encode a UTF-8 string as base64url (no padding). Safely round-trips any JSON
 * (unicode names and the like), unlike a bare `btoa`. */
export function base64UrlEncode(text: string): string {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

/** Decode a base64url string back to UTF-8 text. Throws on invalid input. */
export function base64UrlDecode(code: string): string {
  return new TextDecoder().decode(base64UrlToBytes(code));
}

/** Build a canonical container around a payload. */
export function makeContainer<P>(
  kind: ContainerKind,
  kindVersion: number,
  payload: P,
): Container<P> {
  return {
    format: CONTAINER_FORMAT,
    container: CONTAINER_VERSION,
    kind,
    kindVersion,
    payload,
  };
}

/** Encode a payload as a canonical container's pretty-printed JSON text, for a
 * `.json` file export. */
export function encodeContainerJson<P>(
  kind: ContainerKind,
  kindVersion: number,
  payload: P,
): string {
  return JSON.stringify(makeContainer(kind, kindVersion, payload), null, 2);
}

/**
 * Encode a payload as a canonical container's pasteable code: compressed, then
 * base64url, behind {@link COMPRESSED_CODE_PREFIX}. Compression roughly thirds a
 * long code (issue #557) and still shortens even a near-empty container, since
 * the envelope's own keys compress, so there is no size below which plain
 * base64url wins.
 *
 * Only codes are compressed. `.json` exports stay readable text.
 */
export function encodeContainerCode<P>(
  kind: ContainerKind,
  kindVersion: number,
  payload: P,
): string {
  const json = JSON.stringify(makeContainer(kind, kindVersion, payload));
  const bytes = deflateSync(strToU8(json), { level: 9 });
  return COMPRESSED_CODE_PREFIX + bytesToBase64Url(bytes);
}

/** A code that is safe to hand out, or the measurement showing why it is not. */
export type ContainerCodeResult =
  | { ok: true; code: string }
  | { ok: false; bytes: number; limit: number };

/**
 * Encode a payload as a code only when the far end could read it back, and
 * otherwise report how big it came out and how big a code may be.
 *
 * The ceiling is {@link MAX_INFLATED_BYTES}, the decompression-bomb guard on the
 * decode side. Nothing rounds it down on the way out, so without this check a
 * kind whose payload can grow past it (a scenario carrying dialogue portraits
 * and voice clips, issue #1336) produces a code that copies fine, pastes fine,
 * and then fails to inflate as "corrupted" on someone else's machine. Refusing
 * at the point of copying is the only place the author can still do something
 * about it.
 *
 * Use this wherever a payload has no fixed upper size. {@link encodeContainerCode}
 * stays for the kinds that are bounded by their own shape (a preset, a challenge,
 * a setup pack), where a check would only ever answer yes.
 */
export function tryEncodeContainerCode<P>(
  kind: ContainerKind,
  kindVersion: number,
  payload: P,
): ContainerCodeResult {
  const json = JSON.stringify(makeContainer(kind, kindVersion, payload));
  // UTF-8 bytes, not characters: that is what the inflate buffer holds.
  const bytes = strToU8(json).length;
  if (bytes > MAX_INFLATED_BYTES) {
    return { ok: false, bytes, limit: MAX_INFLATED_BYTES };
  }
  return { ok: true, code: encodeContainerCode(kind, kindVersion, payload) };
}

/** Inflate a `cbz1.` code back to its JSON text, or `null` if it is corrupt,
 * truncated, or larger than {@link MAX_INFLATED_BYTES}. */
function inflateCode(code: string): string | null {
  try {
    const bytes = base64UrlToBytes(code.slice(COMPRESSED_CODE_PREFIX.length));
    if (bytes.length === 0) return null;
    return strFromU8(
      inflateSync(bytes, { out: new Uint8Array(MAX_INFLATED_BYTES) }),
    );
  } catch {
    return null;
  }
}

/**
 * Decode container text that is raw JSON, a compressed code, or a plain
 * base64url code into a plain object, or `null` when none parse. Raw JSON is
 * tried first (a `.json` file), then a code.
 *
 * Codes shared before issue #557 carry no prefix and are plain base64url, so
 * both code forms decode here and no already-pasted code stops working.
 */
export function decodeContainerText(text: string): unknown | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  if (trimmed.startsWith(COMPRESSED_CODE_PREFIX)) {
    const json = inflateCode(trimmed);
    if (json === null) return null;
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Not raw JSON. Fall through to try a plain base64url code.
  }
  try {
    return JSON.parse(base64UrlDecode(trimmed));
  } catch {
    return null;
  }
}

/**
 * Recognise a parsed value as a canonical container (not a legacy shape), or
 * `null`. Only checks the envelope frame, `payload` is left untouched for a
 * kind-specific validator.
 */
export function asContainer(value: unknown): Container | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.format !== CONTAINER_FORMAT) return null;
  if (typeof v.container !== "number") return null;
  if (typeof v.kind !== "string") return null;
  if (typeof v.kindVersion !== "number") return null;
  if (!("payload" in v)) return null;
  return v as unknown as Container;
}

export type Compatibility = "ok" | "newer" | "unknown";

export interface Identification {
  /** What the payload is, or `"unknown"` when nothing matches. */
  kind: ContainerKind | "unknown";
  /** The payload schema version (`kindVersion`), or `0` when unknown. */
  version: number;
  /** `ok` if this build can read it, `newer` if it is from a later coilbox,
   * `unknown` if it is not a recognised coilbox file. */
  compatibility: Compatibility;
  /** Human-readable notes: a newer-version warning, or a mismatch between the
   * declared kind and the payload's actual shape. */
  warnings: string[];
  /** The game this targets, normalised from whichever spelling the payload used
   * (issue #1335). Absent when the payload names no game, which includes an
   * unrecognised file. */
  game?: GameIdentity;
}

/**
 * Guess a kind purely from a payload's shape, or `null`. Used to flag a
 * mismatch such as "declared a campaign but the contents look like a preset",
 * and to recognise a legacy bare preset (which carries no envelope at all).
 */
export function sniffPayloadKind(payload: unknown): ContainerKind | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (p.type === "ta" && Array.isArray(p.missions)) return "campaign";
  // A campaign export carrying scenario media wraps the document the same way a
  // scenario export does, so recognise the wrapper too (kindVersion 2).
  if (typeof p.campaign === "object" && p.campaign !== null) {
    const c = p.campaign as Record<string, unknown>;
    if (c.type === "ta" && Array.isArray(c.missions)) return "campaign";
  }
  // A scenario export wraps the document beside its dialogue media, so the
  // shape to recognise is the wrapper, not the document.
  if (typeof p.scenario === "object" && p.scenario !== null) {
    const s = p.scenario as Record<string, unknown>;
    if (Array.isArray(s.triggers) && Array.isArray(s.zones)) return "scenario";
  }
  if (
    (p.engineVersion === undefined || typeof p.engineVersion === "string") &&
    Array.isArray(p.maps) &&
    typeof p.game === "object" &&
    p.game !== null
  ) {
    return "setup-pack";
  }
  if (
    (p.mode === "conquest" || p.mode === "warpath") &&
    typeof p.settings === "object" &&
    p.settings !== null
  ) {
    return "challenge";
  }
  if (
    Array.isArray(p.participants) &&
    typeof p.gameName === "string" &&
    typeof p.mapName === "string"
  ) {
    return "preset";
  }
  return null;
}

/** Map a recognised kind + schema version to a compatibility verdict. */
function compatibilityFor(
  kind: ContainerKind,
  containerVersion: number,
  kindVersion: number,
): Compatibility {
  if (containerVersion > CONTAINER_VERSION) return "newer";
  if (kindVersion > SUPPORTED_KIND_VERSIONS[kind]) return "newer";
  return "ok";
}

/** A friendly one-liner for a newer-version payload. */
function newerWarning(kind: ContainerKind | "unknown"): string {
  const noun = kind === "unknown" ? "file" : kind;
  return `This ${noun} was made by a newer version of coilbox. Update coilbox to open it.`;
}

/**
 * Detect a legacy (pre-container) shape and map it to a kind + version, or
 * `null`. Keeps already-shared files identifiable. `payload` is the part of the
 * legacy wrapper that corresponds to a container's payload, so the same
 * payload-shaped readers work on it.
 */
function identifyLegacy(
  value: unknown,
): { kind: ContainerKind; version: number; payload: unknown } | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const version = typeof v.formatVersion === "number" ? v.formatVersion : 1;
  if (v.format === "coilbox-campaign") {
    return { kind: "campaign", version, payload: v.campaign };
  }
  if (v.format === "coilbox-challenge") {
    return { kind: "challenge", version, payload: v };
  }
  if (v.format === "coilbox-pack") {
    return { kind: "setup-pack", version, payload: v.settings };
  }
  // A bare preset file carries no envelope, so recognise it by shape.
  if (sniffPayloadKind(v) === "preset") {
    return { kind: "preset", version: 1, payload: v };
  }
  return null;
}

/**
 * "Open a mystery.json and know what it is." Accepts a JSON string, a base64url
 * code, or an already-parsed object, and reports the kind, schema version,
 * whether this build can read it, and any warnings. Never throws.
 *
 * Recognises the canonical container, every legacy shape, and reports anything
 * else as `unknown` rather than misapplying it. Issue #388 uses this to gate a
 * deep-linked payload before handing it to the matching importer.
 */
export function identify(input: string | unknown): Identification {
  const value =
    typeof input === "string" ? decodeContainerText(input) : (input ?? null);
  if (typeof value !== "object" || value === null) {
    return {
      kind: "unknown",
      version: 0,
      compatibility: "unknown",
      warnings: [],
    };
  }

  const container = asContainer(value);
  if (container) {
    const warnings: string[] = [];
    if (!CONTAINER_KINDS.includes(container.kind)) {
      // A coilbox container of a kind this build has never heard of. Treat it
      // as unknown but still surface the newer-version hint.
      return {
        kind: "unknown",
        version: container.kindVersion,
        compatibility: "newer",
        warnings: [newerWarning("unknown")],
      };
    }
    const compatibility = compatibilityFor(
      container.kind,
      container.container,
      container.kindVersion,
    );
    if (compatibility === "newer") warnings.push(newerWarning(container.kind));
    const actual = sniffPayloadKind(container.payload);
    if (actual && actual !== container.kind) {
      warnings.push(
        `This is labelled a ${container.kind} but its contents look like a ${actual}.`,
      );
    }
    const game = gameIdentityFromPayload(container.kind, container.payload);
    return {
      kind: container.kind,
      version: container.kindVersion,
      compatibility,
      warnings,
      ...(game ? { game } : {}),
    };
  }

  const legacy = identifyLegacy(value);
  if (legacy) {
    const compatibility = compatibilityFor(
      legacy.kind,
      CONTAINER_VERSION,
      legacy.version,
    );
    const warnings =
      compatibility === "newer" ? [newerWarning(legacy.kind)] : [];
    const game = gameIdentityFromPayload(legacy.kind, legacy.payload);
    return {
      kind: legacy.kind,
      version: legacy.version,
      compatibility,
      warnings,
      ...(game ? { game } : {}),
    };
  }

  return {
    kind: "unknown",
    version: 0,
    compatibility: "unknown",
    warnings: [],
  };
}

export type OpenError =
  | "malformed"
  | "unknown-format"
  | "unsupported-version"
  | "wrong-kind";

export type OpenResult<P> =
  | { ok: true; payload: P }
  | { ok: false; error: OpenError };

/**
 * Read a canonical container's payload for an expected kind, validating the
 * envelope frame and version before handing the payload to `parsePayload`.
 * Never throws. This is the new-format half of every importer, each of which
 * falls back to its own legacy reader when this returns `unknown-format`.
 *
 * `value` is an already-parsed object (callers decode text once via
 * {@link decodeContainerText}, then try container then legacy on the same object).
 */
export function readContainer<P>(
  value: unknown,
  expectedKind: ContainerKind,
  parsePayload: (payload: unknown) => P | null,
): OpenResult<P> {
  const container = asContainer(value);
  if (!container) return { ok: false, error: "unknown-format" };
  if (container.container > CONTAINER_VERSION) {
    return { ok: false, error: "unsupported-version" };
  }
  if (container.kind !== expectedKind)
    return { ok: false, error: "wrong-kind" };
  if (container.kindVersion > SUPPORTED_KIND_VERSIONS[expectedKind]) {
    return { ok: false, error: "unsupported-version" };
  }
  const payload = parsePayload(container.payload);
  if (!payload) return { ok: false, error: "malformed" };
  return { ok: true, payload };
}
