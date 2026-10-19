import type { MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
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

  "workshop.test.no_edits": () =>
    msg`This project has no edits a mutator archive can carry, so there is nothing to test.`,
  "workshop.package.no_edits": () =>
    msg`This project has no edits a mutator archive can carry, so there is nothing to package.`,
  // The blockers are the preflight checks' own English text, passed through.
  "workshop.package.blockers": (params) => {
    const count = Number(params.count);
    const blockers = params.blockers ?? "";
    return msg`${plural(count, {
      one: `# blocker would reach whoever plays this broken, so it was not packaged: ${blockers}`,
      other: `# blockers would reach whoever plays this broken, so it was not packaged: ${blockers}`,
    })}`;
  },
  "workshop.tweak_slots.explosion_effect": () =>
    msg`This project has a custom explosion effect. A tweak slot cannot carry the effects file it needs, so packing it into a lobby chat line would silently break it. Use the mutator or edit-in-place route instead.`,
  "workshop.tweak_slots.no_edits": () =>
    msg`This project has no edits, so there is nothing to pack for a lobby.`,
  "workshop.tweak_slots.blockers": (params) => {
    const count = Number(params.count);
    const blockers = params.blockers ?? "";
    return msg`${plural(count, {
      one: `# blocker would reach the lobby broken, so it was not packed: ${blockers}`,
      other: `# blockers would reach the lobby broken, so it was not packed: ${blockers}`,
    })}`;
  },

  "play.autohost.not_connected": () =>
    msg`The game has not connected to coilbox.`,
  "play.autohost.not_started": () => msg`The game has not started yet.`,
  "play.autohost.no_answer": (params) => {
    const seconds = params.seconds ?? "";
    return msg`The game did not answer within ${seconds} seconds. Its infolog says why.`;
  },

  "multiplayer.login.refused": () => msg`the server refused the login`,
  "multiplayer.login.ended": () =>
    msg`the connection ended before the login finished`,
  "multiplayer.login.timeout": (params) => {
    const seconds = params.seconds ?? "";
    return msg`the login did not finish within ${seconds}s`;
  },

  "downloads.fetch.https_only": () => msg`Import URLs must be https.`,
  "downloads.fetch.timeout": () => msg`The host took too long to respond.`,
  "downloads.fetch.unreachable": () => msg`Could not reach the host.`,
  "downloads.fetch.status": (params) => {
    const status = params.status ?? "";
    return msg`The host returned an error (${status}).`;
  },
  "downloads.fetch.too_large": () =>
    msg`That import is too large to be a coilbox import.`,
  "downloads.fetch.interrupted": () =>
    msg`The download failed part way through.`,
  "downloads.fetch.not_an_import": () =>
    msg`That import is not a coilbox import.`,

  "hub.endpoint.not_a_hub": () =>
    msg`That address answered, but it is not a coilbox hub.`,
  "hub.endpoint.stopped_answering": () =>
    msg`The hub stopped answering part way through.`,
};

/** The message for a parsed error's code, or `undefined` when the table has none. */
export function uiErrorMessage(error: UiError): MessageDescriptor | undefined {
  const build = error.code === null ? undefined : MESSAGES[error.code];
  return build?.(error.params);
}

/** The text of a parsed error: the translated message for a known code, otherwise the fallback. */
export function describeUiError(error: UiError): string {
  const message = uiErrorMessage(error);
  return message ? i18n._(message) : error.fallback;
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
