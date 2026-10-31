/**
 * What `doConnect` throws when the server refused a login's credentials. The
 * store has already raised the notification by the time this reaches a caller,
 * so a caller that shows its own message for a failed connect leaves this one
 * out rather than saying it twice.
 */
export class LoginRefusedError extends Error {
  /** The server's own reason, for example "invalid password". */
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "LoginRefusedError";
    this.reason = reason;
  }
}
