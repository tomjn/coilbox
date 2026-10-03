import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/relativeTime";

/**
 * How long a running match has been going, as far as the lobby knows.
 *
 * This is time since the match started, not the game's own clock. It counts
 * loading and any pauses, which the engine's clock does not, so it is worded as
 * a start time rather than as game time.
 *
 * `since` is unix millis, or null when nothing says when the match began: a
 * TASServer match that was already running when we logged in, or any match on a
 * protocol that does not send a start time.
 */
export function startedAgo(since: number | null, now: number): string {
  const ago = since === null ? null : agoFrom(since, now);
  return ago ? `Started ${ago}` : "In progress";
}

/** How far into a match watching stops being a short wait. */
const LATE_WATCH_MS = 10 * 60_000;

/**
 * What to tell somebody about to watch a match that is well under way, or null
 * when there is nothing to warn about.
 *
 * An engine that joins late plays the whole match through to catch up. How long
 * that takes depends on the machine, the player count and what happened in the
 * game, so this warns and never refuses.
 */
export function lateWatchWarning(
  since: number | null,
  now: number,
): string | null {
  const catchUp =
    "The engine has to play through all of it to catch up before you see the live game.";
  if (since === null) {
    return `This match was already running when you connected, so coilbox does not know how long it has been going. ${catchUp}`;
  }
  if (now - since < LATE_WATCH_MS) return null;
  return `This match started ${agoFrom(since, now)}. ${catchUp}`;
}

function agoFrom(since: number, now: number): string | null {
  return relativeTime(new Date(since).toISOString(), now);
}

/**
 * The current time, refreshed while `active`, for text that says how long ago
 * something was. Idle when there is nothing on screen to keep current.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
