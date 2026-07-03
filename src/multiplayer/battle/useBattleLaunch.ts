import { Channel } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import { type LaunchEvent, playLaunch } from "@/play/bindings";
import type { PlayTarget } from "@/play/config";
import { mpBuildBattleConfig } from "../bindings";

/**
 * Launch the joined battle: ask the backend to map the current battle to a `play`
 * `BattleConfig` (client-side, pointing at the host), then launch the engine —
 * the same launch path the singleplayer skirmish uses (`SkirmishPage.onStart`).
 * Owns the `running`/`error` lifecycle; resolves when the engine exits.
 */
export function useBattleLaunch(
  serverKey: string | null,
  target: PlayTarget | null,
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
      const { config } = await mpBuildBattleConfig({ serverKey });
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
  }, [serverKey, target]);

  return { running, error, launch };
}
