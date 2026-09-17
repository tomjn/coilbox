import { useCallback, useRef, useState } from "react";
import {
  type AdminOutcome,
  type AdminReply,
  type AdminShape,
  mpAdminCommand,
} from "../bindings";

/**
 * One way for every Server admin tool to send a moderator or admin command
 * and follow it (issue #2773).
 *
 * The queue and the reply parsing are in Rust (`admin_command.rs` in the
 * multiplayer plugin). Commands on one connection go one at a time, and the
 * lines that answer one never reach the store, so they never become toasts.
 * This side only tracks where one request has got to.
 */
export type AdminRequestState =
  /** Nothing asked yet. */
  | { status: "idle" }
  /** Queued or on the wire. */
  | { status: "sending" }
  | { status: "answered"; reply: AdminReply }
  /** The server would not run it, in its own words. */
  | { status: "refused"; reason: string }
  /**
   * Nothing came back in time. For `GETIP`, `FINDIP`, `SETBOTMODE` and the
   * broadcasts this is an answer, so the tool words it to fit.
   */
  | { status: "unanswered" }
  /** It never reached the server: not connected, or the connection dropped. */
  | { status: "failed"; error: string };

const IDLE: AdminRequestState = { status: "idle" };

/**
 * Send `command` on the connection under `serverKey` and wait for how it
 * ended. Only the last of `args` may contain spaces, because uberserver
 * gathers the trailing words into the last argument. Rejects when the command
 * never reached the server.
 */
export function sendAdminCommand(
  serverKey: string,
  command: string,
  args: string[],
  shape: AdminShape,
): Promise<AdminOutcome> {
  return mpAdminCommand({ serverKey, command, args, shape });
}

/** The request state an outcome leaves. */
export function requestStateFor(outcome: AdminOutcome): AdminRequestState {
  switch (outcome.outcome) {
    case "answered":
      return { status: "answered", reply: outcome.reply };
    case "refused":
      return { status: "refused", reason: outcome.reason };
    case "unanswered":
      return { status: "unanswered" };
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Follow one request at a time on the connection under `serverKey`, which a
 * section reads from `useServerAdminKey()`.
 *
 * `send` resolves with the state it ended in as well as setting it, so a tool
 * can act on the answer straight away. Only the latest send is shown: an older
 * one that settles later is dropped. A result for another connection is never
 * shown, so switching servers starts from idle.
 */
export function useAdminRequest(serverKey: string | null) {
  const [held, setHeld] = useState<{
    key: string | null;
    state: AdminRequestState;
  }>({ key: serverKey, state: IDLE });
  const latest = useRef(0);

  const send = useCallback(
    async (
      command: string,
      args: string[],
      shape: AdminShape,
    ): Promise<AdminRequestState> => {
      const mine = ++latest.current;
      const show = (state: AdminRequestState) => {
        if (latest.current === mine) setHeld({ key: serverKey, state });
        return state;
      };
      if (!serverKey) {
        return show({ status: "failed", error: "Not connected." });
      }
      show({ status: "sending" });
      try {
        return show(
          requestStateFor(
            await sendAdminCommand(serverKey, command, args, shape),
          ),
        );
      } catch (e) {
        return show({ status: "failed", error: errorText(e) });
      }
    },
    [serverKey],
  );

  const reset = useCallback(() => {
    latest.current += 1;
    setHeld({ key: serverKey, state: IDLE });
  }, [serverKey]);

  const state = held.key === serverKey ? held.state : IDLE;
  return { state, send, reset };
}
