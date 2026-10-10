import { useEffect, useState } from "react";
import type { DemoTrailer, Metric } from "./bindings";
import { contentReplayTrailer } from "./bindings";
import { metricRegistry } from "./useMetricRegistry";

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Decoded trailers, kept for the session because decoding re-reads the whole
 * file. The promise is what is kept, so the roster and the statistics section
 * asking for one replay at the same moment share one read.
 */
const trailers = new Map<string, Promise<DemoTrailer>>();

function loadTrailer(replayPath: string): Promise<DemoTrailer> {
  let held = trailers.get(replayPath);
  if (!held) {
    held = contentReplayTrailer({ replayPath }).then((r) => r.trailer);
    trailers.set(replayPath, held);
    // A failed read is not kept, so the next visit tries again.
    held.catch(() => trailers.delete(replayPath));
  }
  return held;
}

/**
 * A replay's trailer and the metric registry, for the surfaces that show match
 * statistics. Pass null to fetch nothing, as the roster does when the profile
 * hides statistics.
 */
export function useMatchStats(replayPath: string | null) {
  // The replay `settled` belongs to, so another replay shows nothing of it.
  const [settled, setSettled] = useState<{
    path: string;
    data: { trailer: DemoTrailer; metrics: Metric[] } | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (replayPath === null) return;
    let cancelled = false;
    Promise.all([loadTrailer(replayPath), metricRegistry()])
      .then(([trailer, metrics]) => {
        if (cancelled) return;
        setSettled({
          path: replayPath,
          data: { trailer, metrics },
          error: null,
        });
      })
      .catch((e) => {
        if (!cancelled)
          setSettled({ path: replayPath, data: null, error: errMessage(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [replayPath]);

  const current = replayPath !== null && settled?.path === replayPath;
  return {
    data: current ? settled.data : null,
    loading: replayPath !== null && !current,
    error: current ? settled.error : null,
  };
}
