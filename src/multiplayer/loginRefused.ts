import { parseUiError, UI_ERROR_CODES } from "@/i18n/uiError";

/**
 * What `doConnect` throws when the server refused a login. The store has already
 * raised the notification by the time this reaches a caller, so a caller that
 * shows its own message for a failed connect leaves this one out rather than
 * saying it twice.
 */
export class LoginRefusedError extends Error {
  /** The server's own reason, for example "invalid password", when it gave one. */
  readonly reason: string | null;

  constructor(message: string, reason: string | null) {
    super(message);
    this.name = "LoginRefusedError";
    this.reason = reason;
  }
}

/** Whether a command rejected with the coded error for a refused login. */
export function isLoginRefusedCode(err: unknown): boolean {
  return (
    err instanceof Error &&
    parseUiError(err.message).code === UI_ERROR_CODES.loginRefused
  );
}

/**
 * Whether the server's reason for refusing a login says the password is the
 * problem.
 *
 * `DENIED` (uberserver and Teiserver) and Zero-K's login result carry a reason
 * as free text with no code, so the only way to tell a wrong password from
 * "Already logged in." or a ban is to read the words. That is a choice, and it
 * is made to fail one way: a reason that does not name a password, or that
 * nobody has seen before, is not one. Telling someone to change a correct
 * password is the worse mistake, so the doubtful cases get the neutral wording.
 *
 * A ban is excluded first because its reason is a moderator's own text, which
 * can mention a password without the password being what was refused.
 */
export function isPasswordRefusal(reason: string | null | undefined): boolean {
  if (!reason) return false;
  if (/\bban(ned)?\b/i.test(reason)) return false;
  return /\bpasswords?\b/i.test(reason);
}
