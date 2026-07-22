import { useEffect, useRef } from "react";

/**
 * Auto-download missing battle content on join (issue #439). Joining a battle is
 * an unambiguous "I want to play this", so the missing-content Download button's
 * click is pure friction. When the battle room mounts and detects a missing game
 * or map, we fire the *same* download the button fires — driving the same inline
 * progress UI — instead of waiting for a click. The button stays as the fallback
 * for pause/retry.
 */

/** Settings key: opt out of auto-downloading missing content on join. Default on. */
export const AUTO_DOWNLOAD_ON_JOIN_KEY = "multiplayer.autoDownloadOnJoin";

export interface AutoDownloadInputs {
  /** The opt-out toggle (`AUTO_DOWNLOAD_ON_JOIN_KEY`); false = today's manual flow. */
  enabled: boolean;
  /** The required content (this battle's game/map) is not installed locally. */
  contentMissing: boolean;
  /** A write root is configured; without one we don't auto-download (the manual
   *  missing-write-root guidance still applies). */
  writeRootReady: boolean;
  /** The app-wide download queue is idle, so we don't fight a running rapid download. */
  queueIdle: boolean;
  /** A download for this content is already running (drives the inline progress UI). */
  inFlight: boolean;
  /** Auto-download already fired once for this (battle, content); don't repeat it. */
  alreadyAttempted: boolean;
}

/**
 * Should the auto-download fire now for one piece of required content? Pure so the
 * idempotency/guardrail logic is unit-tested without React. Every guard must hold:
 * the toggle is on, the content is genuinely missing, a write root exists, the
 * download queue is idle, nothing is already downloading this, and we haven't
 * already auto-started it for this battle.
 */
export function shouldAutoStartDownload(i: AutoDownloadInputs): boolean {
  return (
    i.enabled &&
    i.contentMissing &&
    i.writeRootReady &&
    i.queueIdle &&
    !i.inFlight &&
    !i.alreadyAttempted
  );
}

// Session-scoped latch of the (battle, content) keys we've already auto-started, so
// the trigger fires once per required content and survives the child remounts a
// rescan causes (a manual rescan bumps a nonce that remounts the map card). Content
// becoming present unmounts the card; a still-missing remount stays latched.
const autoStartedKeys = new Set<string>();

/**
 * Fire `start` once when auto-download's guards first hold for this content. Called
 * only inside the missing-content components, so mounting *is* "required content is
 * missing" — hence `contentMissing: true`. `start` is the component's own download
 * function, so the auto path and the button drive identical state.
 */
export function useAutoDownload(opts: {
  /** Stable per-(battle, content) key, e.g. `${battleId}:game:${name}`. */
  key: string;
  enabled: boolean;
  writeRootReady: boolean;
  queueIdle: boolean;
  inFlight: boolean;
  start: () => void;
}): void {
  const { key, enabled, writeRootReady, queueIdle, inFlight } = opts;
  const startRef = useRef(opts.start);
  startRef.current = opts.start;
  useEffect(() => {
    const go = shouldAutoStartDownload({
      enabled,
      contentMissing: true,
      writeRootReady,
      queueIdle,
      inFlight,
      alreadyAttempted: autoStartedKeys.has(key),
    });
    if (!go) return;
    autoStartedKeys.add(key);
    startRef.current();
  }, [key, enabled, writeRootReady, queueIdle, inFlight]);
}
