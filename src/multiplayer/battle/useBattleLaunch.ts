import { Channel } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import { type LaunchEvent, playLaunch } from "@/play/bindings";
import type { PlayTarget } from "@/play/config";
import { mpBuildBattleConfig, mpBuildHostConfig } from "../bindings";

/**
 * Launch the current battle: ask the backend to map it to a `play` `BattleConfig`
 * then launch the engine — the same launch path the singleplayer skirmish uses
 * (`SkirmishPage.onStart`). When `host` is set we build a host-mode config
 * (`isHost:true`, bound to our HOSTPORT); otherwise a client config pointing at the
 * host. Owns the `running`/`error` lifecycle; resolves when the engine exits.
 */
export function useBattleLaunch(
  serverKey: string | null,
  target: PlayTarget | null,
  host = false,
) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launch = useCallback(async () => {
    if (!serverKey || !target) return;
    setRunning(true);
    setError(null);
    const onEvent = new Channel<LaunchEvent>();
    onEvent.onmessage = () => {};
    try {
      const { config } = host
        ? await mpBuildHostConfig({ serverKey })
        : await mpBuildBattleConfig({ serverKey });
      const res = await playLaunch({
        config,
        executable: target.executable,
        dataDir: target.dataDir,
        runId: crypto.randomUUID(),
        onEvent,
      });
      if (res.exitCode && res.exitCode !== 0) {
        setError(`Engine exited with code ${res.exitCode}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [serverKey, target, host]);

  return { running, error, launch };
}
