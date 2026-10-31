import { t } from "@lingui/core/macro";
import { Channel } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import { describeError } from "@/i18n/uiError";
import {
  type OaEvent,
  playOaCancel,
  playOaLaunch,
  playOaMaps,
} from "../../play/bindings";
import {
  OA_BATTLE_ROOM_SCREEN,
  oaHostArguments,
  oaMapArgument,
} from "../oaHost";
import { useOpenAnnihilation } from "../openAnnihilation";

/**
 * Start Open Annihilation for the battle this client hosts (issue #4946), and
 * keep the host's in game flag true for as long as OA's battle room is up.
 *
 * The flag is what makes joiners' clients launch, and it means "the host's game
 * is up and taking joiners", so it is raised when OA's status stream reports the
 * battle room screen and not when the process starts. It is lowered when OA
 * exits, however it exits. The battle itself stays open the whole time, so a
 * late joiner can still be seated until the host presses START in OA.
 *
 * Leaving the battle ends OA too, through `cancel`: a battle that no longer
 * exists has no room to host. Moving to another page does not, because the
 * battle is still open.
 */
export function useOaHostLaunch({
  battleId,
  battleMap,
  maxPlayers,
  username,
  setIngame,
}: {
  battleId: number | null;
  /** The lobby's map field for this battle. */
  battleMap: string;
  maxPlayers: number;
  username: string | null;
  setIngame: (ingame: boolean) => void;
}) {
  const [program] = useOpenAnnihilation();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef<string | null>(null);

  const start = useCallback(async () => {
    if (battleId === null || !username || runId.current) return;
    if (!program) {
      setError(t`Set where Open Annihilation is in Settings first.`);
      return;
    }
    setError(null);
    const id = crypto.randomUUID();
    runId.current = id;
    setRunning(true);
    let flagRaised = false;
    const onEvent = new Channel<OaEvent>();
    onEvent.onmessage = (event) => {
      if (
        event.kind === "screen" &&
        event.name === OA_BATTLE_ROOM_SCREEN &&
        !flagRaised
      ) {
        flagRaised = true;
        setIngame(true);
      }
    };
    try {
      // The key `--map` takes is not always the name the lobby carries. A list
      // that will not load leaves the lobby's name to be tried as it stands.
      const maps = await playOaMaps({ path: program.path })
        .then((r) => r.maps)
        .catch(() => []);
      const outcome = await playOaLaunch({
        executable: program.path,
        args: oaHostArguments({
          battleId,
          username,
          map: oaMapArgument(battleMap, maps),
          maxPlayers,
        }),
        runId: id,
        onEvent,
      });
      if (outcome.exitCode) {
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
  }, [battleId, battleMap, maxPlayers, username, program, setIngame]);

  /** Ends OA, for a host who is leaving the battle. */
  const cancel = useCallback(() => {
    if (runId.current) void playOaCancel({ runId: runId.current });
  }, []);

  return { running, error, start, cancel };
}
