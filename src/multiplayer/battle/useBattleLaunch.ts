import { useCallback, useState } from "react";
import type { PlayTarget } from "@/play/config";
import { usePlay } from "@/play/PlayProvider";
import { mpBuildBattleConfig, mpBuildHostConfig } from "../bindings";

/**
 * Launch the current battle: ask the backend to map it to a `play` `BattleConfig`
 * then launch the engine via the shared `PlayProvider` — the same launch path the
 * singleplayer skirmish uses. When `host` is set we build a host-mode config
 * (`isHost:true`, bound to our HOSTPORT); otherwise a client config pointing at
 * the host. `running` is app-wide (one game at a time); `error` is local; the
 * launch resolves when the engine exits.
 */
export function useBattleLaunch(
  serverKey: string | null,
  target: PlayTarget | null,
  host = false,
) {
  const { running, launch } = usePlay();
  const [error, setError] = useState<string | null>(null);

  const doLaunch = useCallback(async () => {
    if (!serverKey || !target) return;
    setError(null);
    try {
      const { config } = host
        ? await mpBuildHostConfig({ serverKey })
        : await mpBuildBattleConfig({ serverKey });
      const res = await launch("battle", {
        config,
        executable: target.executable,
        dataDir: target.dataDir,
      });
      if (res.exitCode && res.exitCode !== 0) {
        setError(`Engine exited with code ${res.exitCode}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [serverKey, target, host, launch]);

  return { running, error, launch: doLaunch };
}
