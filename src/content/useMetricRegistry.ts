import { useEffect, useState } from "react";
import {
  contentMetricRegistry,
  type Metric,
  type MetricRatio,
} from "./bindings";

/** The registry is static, so every surface shares one fetch of it. */
let registryPromise: Promise<{
  metrics: Metric[];
  ratios: MetricRatio[];
}> | null = null;

function registry() {
  registryPromise ??= contentMetricRegistry(undefined).catch((e) => {
    // Don't keep a failure: the next surface to ask should ask again.
    registryPromise = null;
    throw e;
  });
  return registryPromise;
}

export function metricRegistry(): Promise<Metric[]> {
  return registry().then((r) => r.metrics);
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

/** The registry's ratios, from the same fetch. Empty until they arrive. */
export function useRatioRegistry(enabled = true): MetricRatio[] {
  const [ratios, setRatios] = useState<MetricRatio[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    registry()
      .then((r) => {
        if (!cancelled) setRatios(r.ratios);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return ratios;
}
