import { t } from "@lingui/core/macro";
import { useCallback, useState } from "react";
import { oaJoinArguments } from "../oaHost";
import { cancelOaRun, startOaRun, useOaRun } from "../oaRun";
import { useOpenAnnihilation } from "../openAnnihilation";
import { checkHostAddress } from "./hostAddress";

/**
 * Start Open Annihilation joining the room the host of this battle opened
 * (issue #4947), and keep the player's in game flag true for as long as OA's
 * match is on.
 *
 * Only what the lobby carries goes to OA: the host's address as the lobby gave
 * it, the player's name and the room's name. OA's own room does the seating, the
 * map, the rules and readiness. `canRun` is whether a launch could go ahead, and
 * is false until a program path is set.
 *
 * The run is held by `oaRun`, which ends it when the player leaves the battle or
 * loses it. The flag is set when OA's status stream says the match started and
 * lowered when the run ends, however it ends.
 *
 * A refusal reaches `error` two ways. OA ending before it says hello rejects the
 * launch with its own `open-annihilation:` line, which `oaRun` keeps. A refusal
 * after the stream began arrives as an `exit` event with the reason `refused`,
 * and its line stays on the backend, so the room says only that OA refused.
 */
export function useOaJoinLaunch({
  serverKey,
  battleId,
  hostIp,
  hostPort,
  username,
  setIngame,
}: {
  serverKey: string | null;
  battleId: number | null;
  /** The address the lobby gave for the battle. */
  hostIp: string;
  hostPort: string;
  username: string | null;
  setIngame: (ingame: boolean) => void;
}) {
  const [program] = useOpenAnnihilation();
  const run = useOaRun();
  // Why a join could not start, or OA refused after it began, which the run's
  // own error cannot say.
  const [joinError, setJoinError] = useState<string | null>(null);
  const canRun = !!program && !!serverKey && battleId !== null && !!username;
  const ours =
    run.running &&
    run.battle?.serverKey === serverKey &&
    run.battle?.battleId === battleId;

  const join = useCallback(async () => {
    if (!program || !serverKey || battleId === null || !username) return;
    if (run.running) {
      if (!ours) setJoinError(t`Open Annihilation is already running.`);
      return;
    }
    // OA reads no port, so one the lobby left out is not a reason to refuse.
    const verdict = checkHostAddress(hostIp, Number(hostPort) || 1);
    if (verdict.kind === "blocked") {
      setJoinError(verdict.reason);
      return;
    }
    setJoinError(null);
    let flagRaised = false;
    await startOaRun({
      executable: program.path,
      args: oaJoinArguments({ battleId, username, hostIp }),
      battle: { serverKey, battleId },
      onEvent: (event) => {
        if (event.kind === "match" && event.change === "started") {
          if (!flagRaised) {
            flagRaised = true;
            setIngame(true);
          }
        } else if (event.kind === "exit" && event.reason === "refused") {
          setJoinError(t`Open Annihilation refused to join this battle.`);
        }
      },
      onEnd: () => {
        if (flagRaised) setIngame(false);
      },
    });
  }, [
    serverKey,
    battleId,
    hostIp,
    hostPort,
    username,
    program,
    run.running,
    ours,
    setIngame,
  ]);

  return {
    running: ours,
    // A refusal says more than the exit code that goes with it.
    error: joinError ?? run.error,
    canRun,
    join,
    cancel: cancelOaRun,
  };
}
