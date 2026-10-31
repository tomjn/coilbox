import { t } from "@lingui/core/macro";
import { Channel } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import { describeError } from "@/i18n/uiError";
import { type OaEvent, playOaCancel, playOaLaunch } from "../../play/bindings";
import { oaJoinArguments } from "../oaHost";
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
 * The flag is set when OA's status stream says the match started and lowered
 * when OA exits, however it exits.
 *
 * A refusal reaches `error` two ways. OA ending before it says hello rejects the
 * launch with its own `open-annihilation:` line. A refusal after the stream began
 * arrives as an `exit` event with the reason `refused`, and its line stays on
 * the backend, so the room says only that OA refused.
 */
export function useOaJoinLaunch({
  battleId,
  hostIp,
  hostPort,
  username,
  setIngame,
}: {
  battleId: number | null;
  /** The address the lobby gave for the battle. */
  hostIp: string;
  hostPort: string;
  username: string | null;
  setIngame: (ingame: boolean) => void;
}) {
  const [program] = useOpenAnnihilation();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef<string | null>(null);
  const canRun = !!program && battleId !== null && !!username;

  const join = useCallback(async () => {
    if (!program || battleId === null || !username || runId.current) return;
    // OA reads no port, so one the lobby left out is not a reason to refuse.
    const verdict = checkHostAddress(hostIp, Number(hostPort) || 1);
    if (verdict.kind === "blocked") {
      setError(verdict.reason);
      return;
    }
    setError(null);
    const id = crypto.randomUUID();
    runId.current = id;
    setRunning(true);
    let flagRaised = false;
    let refused = false;
    const onEvent = new Channel<OaEvent>();
    onEvent.onmessage = (event) => {
      if (event.kind === "match" && event.change === "started") {
        if (!flagRaised) {
          flagRaised = true;
          setIngame(true);
        }
      } else if (event.kind === "exit" && event.reason === "refused") {
        refused = true;
      }
    };
    try {
      const outcome = await playOaLaunch({
        executable: program.path,
        args: oaJoinArguments({ battleId, username, hostIp }),
        runId: id,
        onEvent,
      });
      if (refused) {
        setError(t`Open Annihilation refused to join this battle.`);
      } else if (outcome.exitCode) {
        const code = outcome.exitCode;
        setError(t`Open Annihilation exited with code ${code}.`);
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      if (flagRaised) setIngame(false);
      runId.current = null;
      setRunning(false);
    }
  }, [battleId, hostIp, hostPort, username, program, setIngame]);

  /** Ends OA, for a player who is leaving the battle. */
  const cancel = useCallback(() => {
    if (runId.current) void playOaCancel({ runId: runId.current });
  }, []);

  return { running, error, canRun, join, cancel };
}
