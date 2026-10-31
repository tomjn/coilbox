import { t } from "@lingui/core/macro";
import { Channel } from "@tauri-apps/api/core";
import { describeError } from "@/i18n/uiError";
import { type OaEvent, playOaCancel, playOaLaunch } from "../play/bindings";
import { oaGameOverLine, parseOaMatch, recordOaMatch } from "./oaMatches";

/**
 * The Open Annihilation (OA) that coilbox started for a battle, held outside
 * any page (issue #4946). OA's discovery port is one per machine, so there is
 * one run at most.
 *
 * It belongs to the battle it was started for. `observeOaBattle` ends it when
 * the lobby shows the player left, was kicked from, or lost that battle while
 * the same session stayed connected. OA's game does not use the lobby
 * connection, so a connection that drops, is gone, or comes back as a fresh
 * session never ends it: OA runs on with no battle.
 *
 * `OaBattleKeeper` starts OA through here. What it does with OA's status stream
 * goes in `onEvent`, and what it undoes when OA is gone goes in `onEnd`. The run
 * itself keeps each finished match (`oaMatches`, issue #4948), since no page is
 * guaranteed to be there when OA says the game is over.
 */

let runId: string | null = null;
/** The battle the running OA is for. */
let runBattle: { serverKey: string; battleId: number } | null = null;
/**
 * Whether the connection has shown the player in the battle during this
 * unbroken stretch of being connected. Only then can a battle that is no longer
 * there mean the player left it.
 */
let inBattleThisSession = false;

/** The battle the running OA is for, or null while none runs. */
export function oaRunBattle() {
  return runId ? runBattle : null;
}

/**
 * Start OA with `args` for `battle`. Does nothing while a run exists. Resolves
 * when OA has exited and `onEnd` has run, and never rejects: a failure goes to
 * `onEnd`, and is forgotten with the run.
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
  /** Once, when OA is gone, however it went, with why it failed or null. */
  onEnd?: (error: string | null) => void;
}): Promise<void> {
  if (runId) return;
  const id = crypto.randomUUID();
  runId = id;
  runBattle = battle;
  inBattleThisSession = true;
  const channel = new Channel<OaEvent>();
  let version: string | null = null;
  let matches = 0;
  // OA's own words when it refuses after its stream began. They say more than
  // the exit code that goes with them.
  let refusal: string | null = null;
  channel.onmessage = (event) => {
    if (event.kind === "exit" && event.reason === "refused" && event.message) {
      refusal = event.message;
    }
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
    if (refusal) {
      error = refusal;
    } else if (outcome.exitCode) {
      const code = outcome.exitCode;
      error = t`Open Annihilation exited with code ${code}.`;
    }
  } catch (e) {
    error = describeError(e);
  } finally {
    // Whatever the caller undoes may talk to a connection that has gone, and a
    // failure there must not leave the run looking as if it still existed.
    try {
      onEnd?.(error);
    } catch {
      // Nothing to do: OA is gone either way.
    }
    runId = null;
    runBattle = null;
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
  const battle = runBattle;
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
