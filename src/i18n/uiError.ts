import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { i18n } from ".";

/**
 * An error a Rust command reports as a stable code, its parameters and the
 * English text it produces today. Mirrors `coilbox-ui-error`'s `UiError`.
 */
export interface UiError {
  /** `null` for a plain string, which carries no code to translate from. */
  code: string | null;
  params: Record<string, string>;
  fallback: string;
}

/** Codes the Rust side raises that other code branches on. */
export const UI_ERROR_CODES = {
  packageTargetExists: "workshop.package.target_exists",
} as const;

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

/**
 * Read the JSON a `UiError` becomes when a command returns it as a string. Any
 * other text, including JSON of another shape, comes back as a fallback-only
 * error so a command that has not migrated yet shows what it always did.
 */
export function parseUiError(message: string): UiError {
  const plain: UiError = { code: null, params: {}, fallback: message };
  if (!message.startsWith("{")) return plain;
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return plain;
  }
  if (typeof value !== "object" || value === null) return plain;
  const { code, params, fallback } = value as Record<string, unknown>;
  if (typeof code !== "string" || typeof fallback !== "string") return plain;
  if (!isStringRecord(params)) return plain;
  return { code, params, fallback };
}

type Params = Record<string, string>;

/**
 * Code to message. Each entry is a function so the lookup happens when an error
 * is shown, after a catalog is active, rather than when this module loads. The
 * English text is the same sentence the Rust side puts in `fallback`.
 */
const MESSAGES: Record<string, (params: Params) => MessageDescriptor> = {
  [UI_ERROR_CODES.packageTargetExists]: (params) => {
    const path = params.path ?? "";
    return msg`${path} already exists; confirm a replace before packaging over it`;
  },
};

/** The text of a parsed error: the translated message for a known code, otherwise the fallback. */
export function describeUiError(error: UiError): string {
  const build = error.code === null ? undefined : MESSAGES[error.code];
  return build ? i18n._(build(error.params)) : error.fallback;
}

/** The text to show a player for anything a command rejected with. */
export function describeError(err: unknown): string {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  return describeUiError(parseUiError(message));
}
