import { t } from "@lingui/core/macro";
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
  return ago ? t`Started ${ago}` : t`In progress`;
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
