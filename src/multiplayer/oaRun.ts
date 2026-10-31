import { t } from "@lingui/core/macro";
import { Channel } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { describeError } from "@/i18n/uiError";
import { type OaEvent, playOaCancel, playOaLaunch } from "../play/bindings";

/**
 * The Open Annihilation (OA) that coilbox started for a battle, held outside
 * any page (issue #4946). OA's discovery port is one per machine, so there is
 * one run at most, and it outlives the battle room page the way a Recoil run
 * outlives it in `PlayProvider`: leaving the page and coming back finds the run
 * still there, and cancelling it still works.
 *
 * It belongs to the battle it was started for. `endOaRunUnlessIn` ends it when
 * that battle is no longer the one its connection is in, however the player
 * left, was kicked, or lost the battle.
 *
 * Hosting and joining both start OA through here. What each does with OA's
 * status stream goes in `onEvent`, and what it undoes when OA is gone goes in
 * `onEnd`.
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
  publish({ running: true, error: null, battle });
  const channel = new Channel<OaEvent>();
  channel.onmessage = (event) => onEvent?.(event);
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
    onEnd?.();
    runId = null;
    publish({ running: false, error, battle: null });
  }
}

/** End the running OA, if there is one. The run's `onEnd` follows. */
export function cancelOaRun() {
  if (runId) void playOaCancel({ runId });
}

/**
 * End the running OA unless its battle is still the one its connection is in.
 * `currentBattle` answers which battle a connection is in, or null.
 */
export function endOaRunUnlessIn(
  currentBattle: (serverKey: string) => number | null,
) {
  const { battle } = state;
  if (battle && currentBattle(battle.serverKey) !== battle.battleId) {
    cancelOaRun();
  }
}
