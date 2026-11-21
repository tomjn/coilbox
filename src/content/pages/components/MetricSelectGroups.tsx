import { i18n } from "@lingui/core";
import { useMemo } from "react";
import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import type { Metric } from "../../bindings";
import { metricGroups } from "../../matchStats";
import { labelOfMetric } from "../../metricLabels";
import {
  labelOfEntry,
  REPLAY_ENTRIES,
  REPLAY_ENTRIES_HEADING,
} from "../../replayEntries";

/**
 * The list of metrics a chooser offers, grouped, for inside a `SelectContent`.
 * The chart's dropdown and the timeline dock's metric lane both open it, so the
 * two lists can't differ (#5308). The registry's groups come first, then the
 * entries drawn from the replay itself (#5321).
 */
export function MetricSelectGroups({ metrics }: { metrics: Metric[] }) {
  const groups = useMemo(() => metricGroups(metrics), [metrics]);
  return (
    <>
      {groups.map((g) => (
        <SelectGroup key={g.group}>
          <SelectLabel>{g.label}</SelectLabel>
          {g.metrics.map((m) => (
            <SelectItem key={m.key} value={m.key}>
              {labelOfMetric(m)}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
      <SelectGroup>
        <SelectLabel>{i18n._(REPLAY_ENTRIES_HEADING)}</SelectLabel>
        {REPLAY_ENTRIES.map((e) => (
          <SelectItem key={e.key} value={e.key}>
            {labelOfEntry(e)}
          </SelectItem>
        ))}
      </SelectGroup>
    </>
  );
}
