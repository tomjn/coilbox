import { useMemo } from "react";
import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import type { Metric } from "../../bindings";
import { metricGroups } from "../../matchStats";
import { labelOfMetric } from "../../metricLabels";

/**
 * The list of metrics a chooser offers, grouped, for inside a `SelectContent`.
 * The chart's dropdown and the timeline dock's metric lane both open it, so the
 * two lists can't differ (#5308).
 */
export function MetricSelectGroups({ metrics }: { metrics: Metric[] }) {
  const groups = useMemo(() => metricGroups(metrics), [metrics]);
  return groups.map((g) => (
    <SelectGroup key={g.group}>
      <SelectLabel>{g.label}</SelectLabel>
      {g.metrics.map((m) => (
        <SelectItem key={m.key} value={m.key}>
          {labelOfMetric(m)}
        </SelectItem>
      ))}
    </SelectGroup>
  ));
}
