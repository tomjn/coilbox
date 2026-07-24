/**
 * The one canonical, self-identifying Coilbox JSON container (issue #479).
 *
 * Every JSON artefact coilbox shares (campaigns, presets, challenge codes,
 * setup packs) wraps its payload in this envelope, so opening any file or
 * pasting any code tells you immediately what it holds and which schema version
 * produced it, without guessing from the payload shape. The same envelope is
 * used for BOTH raw `.json` files AND base64url-wrapped codes, so one decode and
 * identify path serves both (a code is just `base64url(JSON.stringify(envelope))`).
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
 * Issue #388 (deep links) calls {@link identify} to validate an incoming payload
 * before applying it.
 */

/** Top-level marker present on every coilbox container. */
export const CONTAINER_FORMAT = "coilbox";

/** Envelope format version this build writes and understands. */
export const CONTAINER_VERSION = 1;

/** The unambiguous payload discriminator. */
export type ContainerKind = "campaign" | "preset" | "challenge" | "setup-pack";

export const CONTAINER_KINDS: readonly ContainerKind[] = [
  "campaign",
  "preset",
  "challenge",
  "setup-pack",
];

/**
 * Highest payload schema version this build understands, per kind. A container
 * whose `kindVersion` exceeds its kind's entry here is from a newer coilbox and
 * is reported as `newer` rather than silently misread.
 */
export const SUPPORTED_KIND_VERSIONS: Record<ContainerKind, number> = {
  campaign: 1,
  preset: 1,
  challenge: 1,
  "setup-pack": 1,
};

export interface Container<P = unknown> {
  format: typeof CONTAINER_FORMAT;
  container: typeof CONTAINER_VERSION;
  kind: ContainerKind;
  kindVersion: number;
  payload: P;
}

/** Encode a UTF-8 string as base64url (no padding). Safely round-trips any JSON
 * (unicode names and the like), unlike a bare `btoa`. */
export function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decode a base64url string back to UTF-8 text. Throws on invalid input. */
export function base64UrlDecode(code: string): string {
  const padded = code.replace(/-/g, "+").replace(/_/g, "/");
  const pad =
    padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
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

/** Encode a payload as a canonical container's pasteable base64url code. */
export function encodeContainerCode<P>(
  kind: ContainerKind,
  kindVersion: number,
  payload: P,
): string {
  return base64UrlEncode(
    JSON.stringify(makeContainer(kind, kindVersion, payload)),
  );
}

/**
 * Decode container text that is EITHER raw JSON or a base64url code into a plain
 * object, or `null` when neither parses. Raw JSON is tried first (a `.json`
 * file), then base64url (a pasted code), so one call handles both surfaces.
 */
export function decodeContainerText(text: string): unknown | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Not raw JSON. Fall through to try a base64url code.
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
  if (
    typeof p.engineVersion === "string" &&
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

/** Detect a legacy (pre-container) shape and map it to a kind + version, or
 * `null`. Keeps already-shared files identifiable. */
function identifyLegacy(
  value: unknown,
): { kind: ContainerKind; version: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const version = typeof v.formatVersion === "number" ? v.formatVersion : 1;
  if (v.format === "coilbox-campaign") return { kind: "campaign", version };
  if (v.format === "coilbox-challenge") return { kind: "challenge", version };
  if (v.format === "coilbox-pack") return { kind: "setup-pack", version };
  // A bare preset file carries no envelope, so recognise it by shape.
  if (sniffPayloadKind(v) === "preset") return { kind: "preset", version: 1 };
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
    return {
      kind: container.kind,
      version: container.kindVersion,
      compatibility,
      warnings,
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
    return {
      kind: legacy.kind,
      version: legacy.version,
      compatibility,
      warnings,
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
