import { useEffect, useState } from "react";
import { contentMetricRegistry, type Metric } from "./bindings";

/** The registry is static, so every surface shares one fetch of it. */
let registryPromise: Promise<Metric[]> | null = null;

export function metricRegistry(): Promise<Metric[]> {
  registryPromise ??= contentMetricRegistry(undefined)
    .then((r) => r.metrics)
    .catch((e) => {
      // Don't keep a failure: the next surface to ask should ask again.
      registryPromise = null;
      throw e;
    });
  return registryPromise;
}

/**
 * The metric registry, or an empty list until it arrives or if it never does.
 * A caller that only decorates a page with metrics can carry on without them.
 */
export function useMetricRegistry(enabled = true): Metric[] {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    metricRegistry()
      .then((m) => {
        if (!cancelled) setMetrics(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return metrics;
}
