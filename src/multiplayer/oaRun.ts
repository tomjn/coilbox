import { t } from "@lingui/core/macro";
import { Channel } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { describeError } from "@/i18n/uiError";
import { type OaEvent, playOaCancel, playOaLaunch } from "../play/bindings";
import { oaGameOverLine, parseOaMatch, recordOaMatch } from "./oaMatches";

/**
 * The Open Annihilation (OA) that coilbox started for a battle, held outside
 * any page (issue #4946). OA's discovery port is one per machine, so there is
 * one run at most, and it outlives the battle room page the way a Recoil run
 * outlives it in `PlayProvider`: leaving the page and coming back finds the run
 * still there, and cancelling it still works.
 *
 * It belongs to the battle it was started for. `observeOaBattle` ends it when
 * the lobby shows the player left, was kicked from, or lost that battle while
 * the same session stayed connected. OA's game does not use the lobby
 * connection, so a connection that drops, is gone, or comes back as a fresh
 * session never ends it: OA runs on with no battle.
 *
 * Hosting and joining both start OA through here. What each does with OA's
 * status stream goes in `onEvent`, and what it undoes when OA is gone goes in
 * `onEnd`. The run itself keeps each finished match (`oaMatches`, issue #4948),
 * since no page is guaranteed to be there when OA says the game is over.
 */

export interface OaRunState {
  /** OA was started here and has not exited. */
  running: boolean;
  /** Why the last run failed, or null. Kept after the run ends. */
  error: string | null;
  /** The battle the running OA is for, or null while none runs. */
  battle: { serverKey: string; battleId: number } | null;
}

let state: OaRunState = { running: false, error: null, battle: null };
let runId: string | null = null;
/**
 * Whether the connection has shown the player in the battle during this
 * unbroken stretch of being connected. Only then can a battle that is no longer
 * there mean the player left it.
 */
let inBattleThisSession = false;
const listeners = new Set<() => void>();

function publish(next: OaRunState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The run, kept current across renders and across page changes. */
export function useOaRun(): OaRunState {
  return useSyncExternalStore(subscribe, () => state);
}

/**
 * Start OA with `args` for `battle`. Does nothing while a run exists. Resolves
 * when OA has exited and `onEnd` has run, and never rejects: a failure is in
 * the state's `error`.
 */
export async function startOaRun({
  executable,
  args,
  battle,
  onEvent,
  onEnd,
}: {
  executable: string;
  args: string[];
  battle: { serverKey: string; battleId: number };
  /** Each line of OA's status stream. */
  onEvent?: (event: OaEvent) => void;
  /** Once, when OA is gone, however it went. */
  onEnd?: () => void;
}): Promise<void> {
  if (runId) return;
  const id = crypto.randomUUID();
  runId = id;
  inBattleThisSession = true;
  publish({ running: true, error: null, battle });
  const channel = new Channel<OaEvent>();
  let version: string | null = null;
  let matches = 0;
  channel.onmessage = (event) => {
    // A finished match is kept here, as it arrives: a cancel gives no `exit`
    // event, and the page that started the run may be gone.
    try {
      if (event.kind === "hello") version = event.version;
      const line = oaGameOverLine(event);
      if (line) {
        matches += 1;
        recordOaMatch({
          id: `${id}:${matches}`,
          finishedAt: new Date().toISOString(),
          serverKey: battle.serverKey,
          battleId: battle.battleId,
          version,
          ...parseOaMatch(line),
        });
      }
    } catch {
      // Keeping the match must not stop the caller seeing the event.
    }
    onEvent?.(event);
  };
  let error: string | null = null;
  try {
    const outcome = await playOaLaunch({
      executable,
      args,
      runId: id,
      onEvent: channel,
    });
    if (outcome.exitCode) {
      const code = outcome.exitCode;
      error = t`Open Annihilation exited with code ${code}.`;
    }
  } catch (e) {
    error = describeError(e);
  } finally {
    // Whatever the caller undoes may talk to a connection that has gone, and a
    // failure there must not leave the run looking as if it still existed.
    try {
      onEnd?.();
    } catch {
      // Nothing to do: OA is gone either way.
    }
    runId = null;
    publish({ running: false, error, battle: null });
  }
}

/** End the running OA, if there is one. The run's `onEnd` follows. */
export function cancelOaRun() {
  if (runId) void playOaCancel({ runId });
}

/** What the lobby connection a run's battle is on shows right now. */
export interface OaBattleView {
  /** The connection is up: opened and not dropped since. */
  connected: boolean;
  /** The battle the player is in on it, or null. */
  battleId: number | null;
}

/**
 * Look at the lobby and end the running OA if the player has left its battle.
 * `look` answers for a connection, or null when it is gone.
 *
 * Only a connected session that showed the player in the battle and now shows
 * them out of it counts: left, kicked, or the battle closed. A connection that
 * is down or gone breaks the session instead, and one that comes back has to
 * show the player in the battle again before leaving it can end anything. A
 * mirror that is empty because it was just rebuilt is therefore not a leave.
 */
export function observeOaBattle(
  look: (serverKey: string) => OaBattleView | null,
) {
  const { battle } = state;
  if (!battle || !runId) return;
  const view = look(battle.serverKey);
  if (!view?.connected) {
    inBattleThisSession = false;
    return;
  }
  if (view.battleId === battle.battleId) {
    inBattleThisSession = true;
    return;
  }
  if (inBattleThisSession) cancelOaRun();
}

/**
 * The battle a joiner's room already launched OA for by itself, held outside
 * the page (issue #4961). OA exiting leaves the host in game, so a room that is
 * shown again would otherwise launch it a second time. Quitting OA has to mean
 * staying out until the player clicks Join in OA. One battle at most, as one OA
 * runs at a time.
 */
let autoLaunched: {
  serverKey: string;
  battleId: number;
  /** As `inBattleThisSession`, for this battle's memory. */
  inBattleThisSession: boolean;
  /** The player hosts this battle, so the host's flag is their own. */
  hosted: boolean;
} | null = null;

/** Whether the room already launched OA by itself for this battle. */
export function oaAutoLaunchSpent(serverKey: string, battleId: number) {
  return (
    autoLaunched?.serverKey === serverKey && autoLaunched.battleId === battleId
  );
}

/**
 * Record that the room launched OA by itself for this battle. `hosted` is for a
 * battle this client hosts (issue #4964). Its host flag drops when OA exits, so
 * it cannot say the battle is over: only the battle going away forgets it.
 */
export function noteOaAutoLaunch(
  serverKey: string,
  battleId: number,
  hosted = false,
) {
  autoLaunched = { serverKey, battleId, inBattleThisSession: true, hosted };
}

/** What the lobby connection of the remembered battle shows right now. */
export interface OaAutoLaunchView extends OaBattleView {
  /** The host of the player's battle is in game. */
  hostIngame: boolean;
}

/**
 * Forget the remembered auto launch when the battle is over for it. That is
 * when the host is no longer in game (never for a battle the player hosts), or
 * when a connected session that had the player in the battle shows them out of
 * it. A new room from the same host then
 * launches by itself again. This runs from the provider, so it forgets with the
 * room page gone. A drop or a fresh session never forgets, for the reason
 * `observeOaBattle` gives.
 */
export function observeOaAutoLaunch(
  look: (serverKey: string) => OaAutoLaunchView | null,
) {
  if (!autoLaunched) return;
  const view = look(autoLaunched.serverKey);
  if (!view?.connected) {
    autoLaunched.inBattleThisSession = false;
    return;
  }
  if (view.battleId === autoLaunched.battleId) {
    if (view.hostIngame || autoLaunched.hosted) {
      autoLaunched.inBattleThisSession = true;
    } else autoLaunched = null;
    return;
  }
  if (autoLaunched.inBattleThisSession) autoLaunched = null;
}
