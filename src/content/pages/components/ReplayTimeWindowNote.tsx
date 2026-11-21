import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { formatDuration, formatNumber } from "@/lib/format";
import {
  type ActivitySeries,
  captionRange,
  type TimeWindow,
} from "../../replayTimeWindow";

/** Match time as the match's length is written elsewhere on the page, which
 *  drops the part of a second. */
const axisTime = (sec: number) => formatDuration(sec);

/** How many of a layer's points are inside the window, out of all of them. */
export interface WindowCount {
  inside: number;
  total: number;
}

/** What the window is about. Orders have a time they were given, and events
 *  have a time they happened in the playback, and the two are not added up. */
export type WindowSubject = "orders" | "events" | "both";

const SUBJECT_NOTE: Record<WindowSubject, MessageDescriptor> = {
  orders: msg`The window is when an order was given, not when anything was built.`,
  events: msg`The window is when each event happened in the playback.`,
  both: msg`For orders the window is when each was given, not when anything was built. For events it is when each happened in the playback.`,
};

/**
 * What the window means, for the section's help entry: what it filters by, and
 * what is drawn behind the box on the timeline's Heat window lane when there is
 * nothing to draw. Mount it only when a layer reads the window.
 */
export function TimeWindowHelp({
  activity,
  subject,
}: {
  activity: ActivitySeries | null;
  subject: WindowSubject;
}) {
  const { i18n } = useLingui();
  const activityLabel = activity?.label.toLowerCase();
  return (
    <p>
      {i18n._(SUBJECT_NOTE[subject])}{" "}
      {activity ? (
        <Trans>
          Behind the box on the Heat window lane, {activityLabel} across all
          teams.
        </Trans>
      ) : (
        <Trans>No match statistics are drawn behind the box.</Trans>
      )}
    </p>
  );
}

/**
 * The line under the map that says what the window covers, and how many of the
 * layers' points fall inside it. The window itself is set on the timeline
 * dock's Heat window lane (#5309), so this only reads it.
 *
 * `window` is the window as the layers have it, `null` is the whole match, and
 * `matchEndSec` is where the match ended, which no end the line gives passes.
 */
export function ReplayTimeWindowNote({
  matchEndSec,
  window,
  count,
  noun,
  also,
  events = [],
  subject = "orders",
}: {
  matchEndSec: number;
  window: TimeWindow | null;
  /** Null while the layer's points are not known yet. */
  count: WindowCount | null;
  /** What the layer's points are called. */
  noun?: string;
  /** A second kind of point to count, when two layers with different points are on. */
  also?: { count: WindowCount | null; noun: string };
  /** The counts of layers drawn from events, each stated apart from the
   *  orders because an event and an order are different things to count. */
  events?: { noun: string; inside: number; total: number }[];
  /** Which kinds of layer are on. Default orders. */
  subject?: WindowSubject;
}) {
  const { t } = useLingui();
  const subjectText: Record<WindowSubject, string> = {
    orders: t`Orders given`,
    events: t`Events`,
    both: t`Orders given and events`,
  };
  /** A count as a short label, such as "2,897 of 2,897 building orders". */
  const countText = (count: WindowCount, countNoun: string): string => {
    if (count.total === 0) return t`No ${countNoun}.`;
    const inside = formatNumber(count.inside);
    const total = formatNumber(count.total);
    return t`${inside} of ${total} ${countNoun}.`;
  };
  const layerNoun = noun ?? t`orders`;
  if (!(matchEndSec > 0)) return null;

  const subjectLabel = subjectText[subject];
  const range = captionRange(window, matchEndSec);
  const rangeStart = axisTime(range.startSec);
  const rangeEnd = axisTime(range.endSec);
  const matchStart = axisTime(0);
  const matchEnd = axisTime(matchEndSec);

  return (
    <p className="text-xs text-muted-foreground" data-testid="time-window">
      {window
        ? t`${subjectLabel} from ${rangeStart} to ${rangeEnd}.`
        : t`The whole match, ${matchStart} to ${matchEnd}.`}
      {count && ` ${countText(count, layerNoun)}`}
      {also?.count && ` ${countText(also.count, also.noun)}`}
      {events.map((e) => ` ${countText(e, e.noun)}`)}
    </p>
  );
}
