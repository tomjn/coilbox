import { useCallback, useState } from "react";
import { contentListReplays } from "@/content/bindings";
import { useReplayUserState } from "@/content/replayUserState";
import { notify } from "@/notify/notify";
import type { BattleConfig } from "@/play/bindings";
import type { PlayTarget } from "@/play/config";
import { usePlay } from "@/play/PlayProvider";
import { tagFreshReplay } from "@/play/tagReplayProvenance";
import {
  type HostProbeOutcome,
  mpBuildBattleConfig,
  mpBuildHostConfig,
  mpProbeHost,
} from "../bindings";
import { checkHostAddress } from "./hostAddress";

/**
 * Vet the address we are about to point the engine at, while the player can
 * still see a message. Once the engine is up it says nothing but "Connecting
 * to", forever, whatever is wrong.
 *
 * Returns a reason to refuse the launch, or null to go ahead. Only facts block:
 * an address that cannot work, or one that does not resolve. Everything else
 * notifies and launches anyway, because a host that looks unreachable from here
 * may simply not have started their game yet.
 */
async function vetHostAddress(
  ip: string | undefined,
  port: number | undefined,
  natType: string,
): Promise<string | null> {
  const verdict = checkHostAddress(ip, port);
  if (verdict.kind === "blocked") return verdict.reason;
  if (verdict.kind === "warning") {
    await notify({
      title: "Check the host's address",
      body: verdict.reason,
      level: "error",
    });
  }
  // Anything other than "0" means the host expects the lobbies either side to
  // open a path through their routers first. We do not do that, so we connect
  // straight to the advertised address and it works only if the host's port is
  // reachable on its own.
  if (natType !== "" && natType !== "0") {
    await notify({
      title: "This battle expects NAT traversal",
      body: "The host says players need help getting through their router, which coilbox does not do yet. Joining still works if their port is open.",
      level: "error",
    });
  }
  // Blank values are already blocked above, so this only narrows the types.
  if (!ip || !port) return null;

  let outcome: HostProbeOutcome;
  try {
    ({ outcome } = await mpProbeHost({ host: ip, port }));
  } catch {
    return null; // A probe we could not run tells us nothing.
  }
  if (outcome === "unresolved") {
    return `The host's address (${ip}) does not resolve, so the engine cannot connect to it.`;
  }
  if (outcome === "refused") {
    await notify({
      title: "The host is not listening",
      body: `Nothing is bound to ${ip}:${port}. The host may not have started the game yet, or their port may not be forwarded.`,
      level: "error",
    });
  }
  return null;
}

/**
 * Launch the current battle: ask the backend to map it to a `play` `BattleConfig`
 * then launch the engine via the shared `PlayProvider`, the same launch path the
 * singleplayer skirmish uses. When `host` is set we build a host-mode config
 * (`isHost:true`, bound to our HOSTPORT), otherwise a client config pointing at
 * the host, vetted first by [`vetHostAddress`]. `running` is app-wide (one game
 * at a time), `error` is local, and the launch resolves when the engine exits.
 */
export function useBattleLaunch(
  serverKey: string | null,
  target: PlayTarget | null,
  host = false,
) {
  const { running, launch } = usePlay();
  const { setProvenance } = useReplayUserState();
  const [error, setError] = useState<string | null>(null);

  const doLaunch = useCallback(async () => {
    if (!serverKey || !target) return;
    setError(null);
    // Snapshot the replays before the engine runs, so any new file afterwards
    // can be tagged as multiplayer. Best-effort: a failure here just disables
    // tagging for this launch, never the launch itself.
    let beforePaths: Set<string> | null = null;
    try {
      const { replays } = await contentListReplays({ root: target.dataDir });
      beforePaths = new Set(replays.map((r) => r.path));
    } catch {
      beforePaths = null;
    }
    try {
      // Hosts bind 0.0.0.0 and connect to nobody, so only joiners get vetted.
      let config: BattleConfig;
      if (host) {
        config = (await mpBuildHostConfig({ serverKey })).config;
      } else {
        const built = await mpBuildBattleConfig({ serverKey });
        const refusal = await vetHostAddress(
          built.config.hostIp,
          built.config.hostPort,
          built.natType,
        );
        if (refusal) {
          setError(refusal);
          return;
        }
        config = built.config;
      }
      const res = await launch("battle", {
        config,
        executable: target.executable,
        dataDir: target.dataDir,
      });
      if (res.exitCode && res.exitCode !== 0) {
        setError(`Engine exited with code ${res.exitCode}.`);
      }
      if (beforePaths && res.exitCode !== null) {
        tagFreshReplay(
          target.dataDir,
          beforePaths,
          { mode: "multiplayer" },
          setProvenance,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [serverKey, target, host, launch, setProvenance]);

  return { running, error, launch: doLaunch };
}
