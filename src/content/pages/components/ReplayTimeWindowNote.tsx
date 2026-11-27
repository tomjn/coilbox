import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ActivitySeries } from "../../replayTimeWindow";

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
