import { useSetting } from "@picoframe/frame";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LobbyProtocol } from "../lobby-servers/config";
import {
  AUTO_AWAY_ENABLED_KEY,
  AUTO_AWAY_MINUTES_KEY,
  type ClientFlags,
  clampAwayMinutes,
  DEFAULT_AUTO_AWAY_MINUTES,
  resolveStatus,
  sameStatus,
} from "./awayStatus";
import { type LoginPhase, mpSetStatus } from "./bindings";
import { publishesStatus } from "./protocol";
import { useIdle } from "./useIdle";

export interface AwayStatusHook {
  /**
   * Our own client status as last resolved (issue #333). `MYSTATUS` sends both
   * bits together, so the provider owns the pair and is its only sender.
   */
  status: ClientFlags;
  /** Flag the running game, from the battle room's launch/exit path. */
  setIngame: (ingame: boolean) => void;
  /** Whether the user has set themselves away by hand. */
  manualAway: boolean;
  /** Set (or clear) away by hand. Sticky: activity won't clear it, only the
   *  user will, and it survives the idle watcher being off. */
  setManualAway: (away: boolean) => void;
}

/**
 * Away status (issue #333). `MYSTATUS` carries `ingame` and `away` on one line,
 * so the provider owns both bits rather than each caller sending its own pair
 * and clearing the other's. Inputs: the battle room's launch flag, the
 * topbar's manual toggle, and the idle watcher. Both choices are session
 * state, cleared with the connection.
 */
export function useAwayStatus(
  activeKey: string | null,
  protocol: LobbyProtocol,
  phase: LoginPhase | null,
): AwayStatusHook {
  const [ingame, setIngame] = useState(false);
  const [manualAway, setManualAway] = useState(false);
  const [autoAway] = useSetting<boolean>(AUTO_AWAY_ENABLED_KEY, true);
  const [autoAwayMinutes] = useSetting<number>(
    AUTO_AWAY_MINUTES_KEY,
    DEFAULT_AUTO_AWAY_MINUTES,
  );
  // Watching only pays off when idling could actually change the status: not
  // while disconnected, off, already manually away, or in a game (where the
  // engine, not the webview, is taking the input).
  const idle = useIdle(
    activeKey != null && autoAway && !manualAway && !ingame,
    clampAwayMinutes(autoAwayMinutes),
  );
  const status = useMemo(
    () => resolveStatus({ ingame, manualAway, idle }),
    [ingame, manualAway, idle],
  );

  // What we last put on the wire, or null for "unknown". A session starts unknown
  // rather than assuming the server's defaults, because the reattach path adopts a
  // connection that may already be flagged in-game (a reload during a match). We'd
  // otherwise dedupe the clearing send away and stay in-game until the app quits.
  const sentStatusRef = useRef<ClientFlags | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeKey is the reset trigger (a session change), not read in the body
  useEffect(() => {
    sentStatusRef.current = null;
    setIngame(false);
    setManualAway(false);
  }, [activeKey]);

  // Tachyon carries readiness per lobby rather than as a client-wide status, so a
  // Tachyon connection publishes nothing here (see `publishesStatus`).
  useEffect(() => {
    if (activeKey == null || phase !== "ready") return;
    if (!publishesStatus(protocol)) return;
    const sent = sentStatusRef.current;
    if (sent && sameStatus(sent, status)) return;
    sentStatusRef.current = status;
    mpSetStatus({ serverKey: activeKey, ...status }).catch((e) =>
      console.warn("multiplayer: MYSTATUS failed", e),
    );
  }, [activeKey, protocol, phase, status]);

  return { status, setIngame, manualAway, setManualAway };
}
