import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useState } from "react";
import { describeError } from "@/i18n/uiError";
import { playOaMaps } from "../../play/bindings";
import {
  OA_BATTLE_ROOM_SCREEN,
  oaHostArguments,
  oaMapArgument,
} from "../oaHost";
import {
  cancelOaRun,
  noteOaAutoLaunch,
  oaAutoLaunchSpent,
  startOaRun,
  useOaRun,
} from "../oaRun";
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
 * The run is held by `oaRun`, not by the page, so it survives the host moving
 * to another page and back, and it ends when the battle does. `setIngame` is
 * the multiplayer provider's, which does not depend on the page either.
 *
 * With `autoStart`, the first time the host is in the room of a battle, OA is
 * started without a click (issue #4964).
 */
export function useOaHostLaunch({
  serverKey,
  battleId,
  battleMap,
  maxPlayers,
  username,
  setIngame,
  autoStart,
}: {
  serverKey: string | null;
  battleId: number | null;
  /** The lobby's map field for this battle. */
  battleMap: string;
  maxPlayers: number;
  username: string | null;
  setIngame: (ingame: boolean) => void;
  /** This client hosts the OA battle on screen, so OA opens by itself once. */
  autoStart: boolean;
}) {
  const [program] = useOpenAnnihilation();
  const run = useOaRun();
  // Why Start could not even try, which the run's own error cannot say.
  const [startError, setStartError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (!serverKey || battleId === null || !username) return;
    if (!program) {
      setStartError(t`Set where Open Annihilation is in Settings first.`);
      return;
    }
    setStartError(null);
    let flagRaised = false;
    try {
      // The key `--map` takes is not always the name the lobby carries. A list
      // that will not load leaves the lobby's name to be tried as it stands.
      const maps = await playOaMaps({ path: program.path })
        .then((r) => r.maps)
        .catch(() => []);
      await startOaRun({
        executable: program.path,
        args: oaHostArguments({
          battleId,
          username,
          map: oaMapArgument(battleMap, maps),
          maxPlayers,
        }),
        battle: { serverKey, battleId },
        onEvent: (event) => {
          // A match that starts without the room screen having been seen still
          // means the host is in game.
          const inGame =
            (event.kind === "screen" && event.name === OA_BATTLE_ROOM_SCREEN) ||
            (event.kind === "match" && event.change === "started");
          if (inGame && !flagRaised) {
            flagRaised = true;
            setIngame(true);
          }
        },
        onEnd: () => {
          if (flagRaised) setIngame(false);
        },
      });
    } catch (e) {
      setStartError(describeError(e));
    }
  }, [
    serverKey,
    battleId,
    battleMap,
    maxPlayers,
    username,
    program,
    setIngame,
  ]);

  // Hosting is one step: OA opens by itself when the host arrives in the room of
  // a battle they have just opened. The memory is the battle's, outside the
  // page, so a host who quits OA and comes back gets the button and nothing
  // else. Without an OA set there is nothing to start, and nothing is spent, so
  // the host who then sets one is not left with a room that never opened it.
  useEffect(() => {
    if (!autoStart || !program || !serverKey || battleId === null) return;
    if (!username || oaAutoLaunchSpent(serverKey, battleId)) return;
    noteOaAutoLaunch(serverKey, battleId, true);
    void start();
  }, [autoStart, program, serverKey, battleId, username, start]);

  return {
    running: run.running,
    error: startError ?? run.error,
    start,
    cancel: cancelOaRun,
  };
}
