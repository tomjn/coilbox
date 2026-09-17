import type { LobbyEvent, LobbyState, LoginPhase } from "./bindings";

/**
 * A per-connection mirror of the Rust-side lobby state. The Rust plugin owns the
 * authoritative parse; this mirror is refreshed wholesale from `mpSnapshot` on each
 * `delta` event (correctness over incremental cleverness) while `phase` and
 * `console` are driven directly off the event stream.
 */
export interface LobbyMirror {
  connected: boolean;
  phase: LoginPhase | null;
  state: LobbyState | null;
  consoleLines: string[];
  error: string | null;
  /** Reason from the last failed JOINBATTLE/OPENBATTLE, cleared on next attempt. */
  lastJoinError: string | null;
  /**
   * Reason from the last rejected LOGIN (`DENIED`), for a precise inline error on
   * the login form ("Login failed: …"). Set from the `loginDenied` delta, which
   * arrives just before the connection's `disconnected` teardown, and deliberately
   * preserved across that `disconnected` so the inline message survives it. Cleared
   * on the next connect attempt (`connecting` resets the whole mirror).
   */
  loginError: string | null;
  /**
   * Monotonic count of `ENDOFCHANNELS` completions (the `channelListReceived`
   * delta). The channel-list stream emits no per-row delta, so this is the only
   * observable "directory finished loading" signal — the browser drawer watches
   * it advance to end its loading state, honestly, even for an empty directory.
   */
  channelListReceivedSeq: number;
  /**
   * The server's confirmed ignore list from the last `IGNORELIST` (the
   * `serverIgnoreList` delta), plus a monotonic count of how many have arrived.
   * The reconcile effect watches the seq advance and reads this payload directly
   * (rather than the async snapshot) so it can't race an in-flight snapshot fetch.
   */
  serverIgnoreList: string[];
  serverIgnoreListSeq: number;
  /**
   * The last few `SERVERMSG` announcements, plus a running total of how many
   * have ever arrived. Both, because a caller wants "what did the server say
   * while I was doing that", and a count taken before an action is the only way
   * to ask it: the list is capped, so an index into it is not stable.
   *
   * Kept for the tweak-slot delivery run (issue #1279), which sends lines big
   * enough for a server to refuse. Uberserver names its own limit when it drops
   * an over-long command, and quoting that beats reporting a timeout. The toast
   * these also raise is transient by design and gone by the time anyone reads a
   * failure report.
   */
  serverMessages: string[];
  serverMessageCount: number;
  /**
   * Monotonic count of `battleStarting` events: a Tachyon server telling us
   * where the match is. There is no state behind it, because the connection has
   * already promised the server we will be there, so the room watches this
   * advance and launches.
   */
  battleStartSeq: number;
}

const CONSOLE_CAP = 500;

/** How many server announcements to keep. Enough to cover one slot's flight in
 *  a delivery run, which is the only thing that reads them back. */
const SERVER_MESSAGE_CAP = 20;

/**
 * The announcements that arrived after a running total was taken.
 *
 * The kept list is capped and the total is not, so the answer is the last
 * `total - since` of it. Clamped to what is still there, because a burst longer
 * than the cap has already thrown some away and reporting the wrong ones would
 * be worse than reporting fewer.
 */
export function serverMessagesSince(
  m: Pick<LobbyMirror, "serverMessages" | "serverMessageCount">,
  since: number,
): string[] {
  const wanted = Math.max(0, m.serverMessageCount - since);
  return wanted === 0 ? [] : m.serverMessages.slice(-wanted);
}

export const initialMirror: LobbyMirror = {
  connected: false,
  phase: null,
  state: null,
  consoleLines: [],
  error: null,
  lastJoinError: null,
  loginError: null,
  channelListReceivedSeq: 0,
  serverIgnoreList: [],
  serverIgnoreListSeq: 0,
  serverMessages: [],
  serverMessageCount: 0,
  battleStartSeq: 0,
};

export type MirrorAction =
  | { type: "connecting" }
  | { type: "event"; ev: LobbyEvent }
  | { type: "snapshot"; state: LobbyState }
  | { type: "reset" }
  | { type: "clearJoinError" };

/**
 * Fold one action into the mirror. `delta` events are intentionally not applied
 * here — the provider re-fetches a snapshot and dispatches `snapshot` instead, so
 * the mirror never drifts from the authoritative state.
 */
export function mirrorReducer(
  m: LobbyMirror,
  action: MirrorAction,
): LobbyMirror {
  switch (action.type) {
    case "connecting":
      return { ...initialMirror, connected: false };
    case "snapshot":
      return { ...m, state: action.state };
    case "reset":
      return initialMirror;
    case "clearJoinError":
      return { ...m, lastJoinError: null };
    case "event": {
      const ev = action.ev;
      switch (ev.kind) {
        case "connected":
          return { ...m, connected: true, error: null };
        case "phase":
          return { ...m, phase: ev.phase };
        case "console": {
          const line = `${ev.direction === "out" ? ">>" : "<<"} ${ev.line}`;
          const next = [...m.consoleLines, line];
          return {
            ...m,
            consoleLines:
              next.length > CONSOLE_CAP ? next.slice(-CONSOLE_CAP) : next,
          };
        }
        case "battleStarting":
          return { ...m, battleStartSeq: m.battleStartSeq + 1 };
        case "disconnected":
          return { ...m, connected: false, error: ev.reason ?? null };
        case "delta": {
          const d = ev.delta;
          if (d.kind === "joinBattleFailed" || d.kind === "openBattleFailed") {
            return { ...m, lastJoinError: d.reason };
          }
          // Somebody who cannot forward a port hosts through the lobby's relay,
          // and the lobby is what says whether they may. A refusal is the
          // difference between hosting and not, so it goes where the other
          // reasons a battle would not open go rather than into a log nobody
          // reads.
          if (d.kind === "turnCredentialsRefused") {
            return {
              ...m,
              lastJoinError: `the lobby would not hand out a relay credential: ${d.reason}`,
            };
          }
          if (d.kind === "loginDenied") {
            return { ...m, loginError: d.reason };
          }
          if (d.kind === "channelListReceived") {
            return {
              ...m,
              channelListReceivedSeq: m.channelListReceivedSeq + 1,
            };
          }
          // An announcement is a toast for whoever is looking, but it is also
          // the only place a server explains itself when it drops a command for
          // being too long. Keep the last few so a delivery run can say what
          // happened rather than only that nothing came back (issue #1279).
          if (d.kind === "serverMessage") {
            const next = [...m.serverMessages, d.text];
            return {
              ...m,
              serverMessages:
                next.length > SERVER_MESSAGE_CAP
                  ? next.slice(-SERVER_MESSAGE_CAP)
                  : next,
              serverMessageCount: m.serverMessageCount + 1,
            };
          }
          // The full server ignore list finished streaming: record it and tick the
          // seq so the reconcile effect runs exactly once against this payload.
          if (d.kind === "serverIgnoreList") {
            return {
              ...m,
              serverIgnoreList: d.ignores,
              serverIgnoreListSeq: m.serverIgnoreListSeq + 1,
            };
          }
          // The server's message-of-the-day arrives as a run of MOTD lines at
          // login. Log each as a clean `MOTD |` entry so the welcome/news reads
          // as a contiguous block in the console, distinct from the raw `<<`
          // wire echo of the same lines.
          if (d.kind === "motd") {
            const next = [...m.consoleLines, `MOTD | ${d.line}`];
            return {
              ...m,
              consoleLines:
                next.length > CONSOLE_CAP ? next.slice(-CONSOLE_CAP) : next,
            };
          }
          return m;
        }
        // `delta` is otherwise handled by the provider via a snapshot refresh.
        default:
          return m;
      }
    }
    default:
      return m;
  }
}
